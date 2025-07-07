// server.js
const express = require('express');
const axios = require('axios');
const cors = require('cors');

const app = express();
app.use(cors());

let cachedData = { updated: null, stats: null };

const ROSTER_CSV_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vRe5WoA--wsfCCCvtL8QgQKsJv0z1AIUTY7k5NEYgUF-Ipu3Iotxkcbw7D-Cme6YGUksHy3DmyDYpaO/pub?output=csv';

async function fetchWithRetry(url, retries = 3, delayMs = 1000) {
  for (let i = 0; i < retries; i++) {
    try {
      return await axios.get(url);
    } catch (e) {
      if (i === retries - 1) throw e;
      await new Promise(r => setTimeout(r, delayMs));
    }
  }
}

async function fetchKarma(userId) {
  const apiUrl = `https://api.real.vg/user/${userId}/karmafeed`;
  const proxyUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(apiUrl)}`;
  try {
    const res = await fetchWithRetry(proxyUrl);
    const data = JSON.parse(res.data.contents);
    const delta = data?.stats?.karmaDelta;
    return typeof delta === 'number' ? delta : Number(delta) || 0;
  } catch {
    return 0;
  }
}

function parseCSV(text) {
  const lines = text.trim().split('\n');
  const headers = lines[0].split(',').map(h => h.trim());
  return lines.slice(1).map(line => {
    const parts = line.split(',').map(p => p.trim());
    const obj = {};
    headers.forEach((h, i) => {
      obj[h] = parts[i];
    });
    return obj;
  });
}

async function updateStats() {
  try {
    const res = await axios.get(ROSTER_CSV_URL);
    const players = parseCSV(res.data).filter(p => p['playing?']?.toLowerCase() === 'yes');

    const teamScores = {};
    const userScores = [];

    for (const p of players) {
      const userId = p['User ID'];
      const userAt = p['User @'] || 'unknown';
      const role = (p['role'] || '').toLowerCase();
      const isCaptain = role === 'captain';
      const team = p.Team;
      const deduction = parseFloat(p.deductions || 0);
      const karma = await fetchKarma(userId);
      const adjusted = karma - deduction;
      const boosted = isCaptain ? adjusted * 1.5 : adjusted;

      userScores.push({ name: `${userAt}${isCaptain ? ' (c)' : ''}`, score: boosted });

      if (!teamScores[team]) teamScores[team] = 0;
      teamScores[team] += boosted;
    }

    const teamList = Object.entries(teamScores).map(([team, score]) => ({ team, score }));
    const sortedTeams = teamList.sort((a, b) => b.score - a.score);
    const sortedUsers = userScores.sort((a, b) => b.score - a.score);

    const median = sortedTeams.length % 2 === 1
      ? Math.round(sortedTeams[Math.floor(sortedTeams.length / 2)].score)
      : Math.round((sortedTeams[sortedTeams.length / 2 - 1].score + sortedTeams[sortedTeams.length / 2].score) / 2);

    cachedData = {
      updated: new Date().toISOString(),
      stats: {
        topTeams: sortedTeams.slice(0, 3),
        bottomTeams: sortedTeams.slice(-3),
        median,
        topUsers: sortedUsers.slice(0, 5),
        bottomUsers: sortedUsers.slice(-5),
      }
    };

    console.log('Stats updated:', cachedData.updated);
  } catch (err) {
    console.error('Error updating stats:', err.message);
  }
}

// Update every 10 minutes (when running locally)
setInterval(updateStats, 10 * 60 * 1000);
updateStats();

app.get('/api/stats', (req, res) => {
  if (!cachedData.stats) {
    return res.status(503).json({ error: 'Stats not available yet' });
  }
  res.json(cachedData);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Backend listening on port ${PORT}`);
});
