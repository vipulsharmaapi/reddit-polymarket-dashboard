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

function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    const options = {
      headers: { 'User-Agent': 'PolymarketDashboard/1.0 (competitor analysis tool)' },
      timeout: 8000
    };
    const req = https.get(url, options, (res) => {
      if (res.statusCode === 429) {
        reject(new Error('Rate limited'));
        return;
      }
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error('Parse error')); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
  });
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

  return {
    name: sub,
    displayName: info.display_name_prefixed,
    description: info.public_description || info.title || '',
    subscribers: info.subscribers,
    activeUsers: info.accounts_active || info.active_user_count || 0,
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
    }))
  };
}

module.exports = async function handler(req, res) {
  try {
    // Fetch ALL 8 subreddits in parallel (no delays) for speed
    const results = await Promise.all(
      SUBREDDITS.map(sub =>
        fetchSubredditData(sub).catch(err => ({
          name: sub,
          error: err.message,
          subscribers: 0,
          activeUsers: 0,
          recentPostCount: 0,
          recentUpvotes: 0,
          recentComments: 0,
          avgScore: 0,
          avgComments: 0,
          postsPerK: 0,
          upvotesPerK: 0,
          commentsPerK: 0,
          hotPosts: [],
          newPosts: []
        }))
      )
    );

    const data = {
      subreddits: results,
      fetchedAt: new Date().toISOString()
    };

    // Cache for 2 min, serve stale for 5 min while revalidating
    res.setHeader('Cache-Control', 's-maxage=120, stale-while-revalidate=300');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.status(200).json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
