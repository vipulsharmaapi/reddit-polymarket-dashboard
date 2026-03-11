const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3456;

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

// Report baseline data for comparison (from Mar 6 report)
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

let cache = { data: null, timestamp: 0 };
const CACHE_TTL = 2 * 60 * 1000; // 2 min cache to avoid rate limits

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
  // Fetch about info + new posts + hot posts
  const [about, newPosts, hotPosts] = await Promise.all([
    fetchJSON(`https://www.reddit.com/r/${sub}/about.json`),
    fetchJSON(`https://www.reddit.com/r/${sub}/new.json?limit=25`),
    fetchJSON(`https://www.reddit.com/r/${sub}/hot.json?limit=10`)
  ]);

  const info = about.data;
  const posts = newPosts.data.children.map(p => p.data);
  const hot = hotPosts.data.children.map(p => p.data);

  // Calculate 30-day stats from recent posts
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
    banner: info.banner_background_image?.replace(/&amp;/g, '&') || '',
    // Stats from fetched posts (last 25 posts - sample)
    recentPostCount: recentPosts.length,
    recentUpvotes: totalUpvotes,
    recentComments: totalComments,
    avgScore: recentPosts.length ? (totalUpvotes / recentPosts.length).toFixed(1) : 0,
    avgComments: recentPosts.length ? (totalComments / recentPosts.length).toFixed(1) : 0,
    // Normalized per 1K subs
    postsPerK: info.subscribers ? ((recentPosts.length / info.subscribers) * 1000).toFixed(1) : 0,
    upvotesPerK: info.subscribers ? ((totalUpvotes / info.subscribers) * 1000).toFixed(1) : 0,
    commentsPerK: info.subscribers ? ((totalComments / info.subscribers) * 1000).toFixed(1) : 0,
    // Hot/trending posts
    hotPosts: hot.slice(0, 5).map(p => ({
      title: p.title,
      score: p.score,
      comments: p.num_comments,
      url: `https://reddit.com${p.permalink}`,
      created: p.created_utc,
      author: p.author,
      flair: p.link_flair_text || ''
    })),
    // New posts
    newPosts: recentPosts.slice(0, 5).map(p => ({
      title: p.title,
      score: p.score,
      comments: p.num_comments,
      url: `https://reddit.com${p.permalink}`,
      created: p.created_utc,
      author: p.author,
      flair: p.link_flair_text || ''
    })),
    // Baseline comparison
    baseline: {
      subs: baseline.subs || 0,
      subsDelta: baseline.subs ? info.subscribers - baseline.subs : null
    }
  };
}

async function fetchAllData() {
  if (cache.data && (Date.now() - cache.timestamp) < CACHE_TTL) {
    return cache.data;
  }

  const results = [];
  // Fetch in batches of 2 to avoid rate limiting
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
    if (i + 2 < SUBREDDITS.length) await delay(1000); // Rate limit pause
  }

  const data = {
    subreddits: results,
    fetchedAt: new Date().toISOString(),
    reportDate: '2026-03-06',
    reportBaseline: REPORT_BASELINE
  };

  cache = { data, timestamp: Date.now() };
  return data;
}

// MIME types
const MIME = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml'
};

const server = http.createServer(async (req, res) => {
  // API endpoint
  if (req.url === '/api/data') {
    try {
      const data = await fetchAllData();
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      });
      res.end(JSON.stringify(data));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // Force refresh endpoint
  if (req.url === '/api/refresh') {
    cache = { data: null, timestamp: 0 };
    try {
      const data = await fetchAllData();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(data));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // Static files
  let filePath = req.url === '/' ? '/index.html' : req.url;
  filePath = path.join(__dirname, 'public', filePath);

  const ext = path.extname(filePath);
  const contentType = MIME[ext] || 'application/octet-stream';

  fs.readFile(filePath, (err, content) => {
    if (err) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(content);
  });
});

server.listen(PORT, () => {
  console.log(`Dashboard running at http://localhost:${PORT}`);
  console.log(`Tracking ${SUBREDDITS.length} subreddits: ${SUBREDDITS.join(', ')}`);
  console.log('Auto-refresh: every 30 minutes');
});
