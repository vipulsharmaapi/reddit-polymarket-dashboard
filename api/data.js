const https = require('https');

const SUBREDDITS = [
  'Polymarket',
  'Kalshi',
  'polymarket_bets',
  'polymarket_news',
  'polymarket_Traders',
  'PredictionMarkets',
  'polymarketanalysis',
  'ManifoldMarkets'
];

const REPORT_BASELINE = {
  'Polymarket':         { subs: 1505, posts: 34, upvotes: 79, comments: 53 },
  'Kalshi':             { subs: 28834, posts: 995, upvotes: 6772, comments: 9343 },
  'polymarket_bets':    { subs: 4554, posts: 260, upvotes: 2478, comments: 1948 },
  'polymarket_news':    { subs: 675, posts: 139, upvotes: 703, comments: 498 },
  'polymarket_Traders': { subs: 154, posts: 84, upvotes: 91, comments: 115 },
  'PredictionMarkets':  { subs: 2281, posts: 81, upvotes: 356, comments: 210 },
  'polymarketanalysis': { subs: 340, posts: 61, upvotes: 81, comments: 121 },
  'ManifoldMarkets':    { subs: 386, posts: 3, upvotes: 6, comments: 3 }
};

function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    const options = {
      headers: { 'User-Agent': 'PolymarketDashboard/1.0 (competitor analysis tool)' }
    };
    https.get(url, options, (res) => {
      if (res.statusCode === 429) {
        reject(new Error(`Rate limited on ${url}`));
        return;
      }
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error(`Parse error for ${url}: ${e.message}`)); }
      });
    }).on('error', reject);
  });
}

function delay(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function fetchSubredditData(sub) {
  const [about, newPosts, hotPosts] = await Promise.all([
    fetchJSON(`https://www.reddit.com/r/${sub}/about.json`),
    fetchJSON(`https://www.reddit.com/r/${sub}/new.json?limit=25`),
    fetchJSON(`https://www.reddit.com/r/${sub}/hot.json?limit=10`)
  ]);

  const info = about.data;
  const posts = newPosts.data.children.map(p => p.data);
  const hot = hotPosts.data.children.map(p => p.data);

  const now = Date.now() / 1000;
  const thirtyDaysAgo = now - (30 * 24 * 60 * 60);
  const recentPosts = posts.filter(p => p.created_utc > thirtyDaysAgo);

  const totalUpvotes = recentPosts.reduce((s, p) => s + p.score, 0);
  const totalComments = recentPosts.reduce((s, p) => s + p.num_comments, 0);

  const baseline = REPORT_BASELINE[sub] || {};

  return {
    name: sub,
    displayName: info.display_name_prefixed,
    description: info.public_description || info.title || '',
    subscribers: info.subscribers,
    activeUsers: info.accounts_active || info.active_user_count || 0,
    created: info.created_utc,
    icon: info.community_icon?.replace(/&amp;/g, '&') || info.icon_img || '',
    recentPostCount: recentPosts.length,
    recentUpvotes: totalUpvotes,
    recentComments: totalComments,
    avgScore: recentPosts.length ? (totalUpvotes / recentPosts.length).toFixed(1) : 0,
    avgComments: recentPosts.length ? (totalComments / recentPosts.length).toFixed(1) : 0,
    postsPerK: info.subscribers ? ((recentPosts.length / info.subscribers) * 1000).toFixed(1) : 0,
    upvotesPerK: info.subscribers ? ((totalUpvotes / info.subscribers) * 1000).toFixed(1) : 0,
    commentsPerK: info.subscribers ? ((totalComments / info.subscribers) * 1000).toFixed(1) : 0,
    hotPosts: hot.slice(0, 5).map(p => ({
      title: p.title,
      score: p.score,
      comments: p.num_comments,
      url: `https://reddit.com${p.permalink}`,
      created: p.created_utc,
      author: p.author,
      flair: p.link_flair_text || ''
    })),
    newPosts: recentPosts.slice(0, 5).map(p => ({
      title: p.title,
      score: p.score,
      comments: p.num_comments,
      url: `https://reddit.com${p.permalink}`,
      created: p.created_utc,
      author: p.author,
      flair: p.link_flair_text || ''
    })),
    baseline: {
      subs: baseline.subs || 0,
      subsDelta: baseline.subs ? info.subscribers - baseline.subs : null
    }
  };
}

module.exports = async function handler(req, res) {
  try {
    const results = [];
    for (let i = 0; i < SUBREDDITS.length; i += 2) {
      const batch = SUBREDDITS.slice(i, i + 2);
      const batchResults = await Promise.all(
        batch.map(sub => fetchSubredditData(sub).catch(err => ({
          name: sub,
          error: err.message,
          subscribers: 0,
          activeUsers: 0
        })))
      );
      results.push(...batchResults);
      if (i + 2 < SUBREDDITS.length) await delay(1000);
    }

    const data = {
      subreddits: results,
      fetchedAt: new Date().toISOString(),
      reportDate: '2026-03-06',
      reportBaseline: REPORT_BASELINE
    };

    res.setHeader('Cache-Control', 's-maxage=120, stale-while-revalidate=300');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.status(200).json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
