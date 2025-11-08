import axios from 'axios';
import { config } from 'dotenv';

config();

let accessToken = null;
let tokenExpiry = null;

async function getAccessToken() {
  if (accessToken && tokenExpiry && Date.now() < tokenExpiry) {
    return accessToken;
  }

  try {
    const response = await axios.post(
      'https://id.twitch.tv/oauth2/token',
      null,
      {
        params: {
          client_id: process.env.TWITCH_CLIENT_ID,
          client_secret: process.env.TWITCH_CLIENT_SECRET,
          grant_type: 'client_credentials',
        },
      }
    );

    accessToken = response.data.access_token;
    tokenExpiry = Date.now() + response.data.expires_in * 1000 - 60000;

    return accessToken;
  } catch (error) {
    console.error(
      'Failed to get Twitch access token:',
      error.response?.data || error.message
    );
    throw error;
  }
}

async function makeApiRequest(endpoint, params = {}) {
  const token = await getAccessToken();

  try {
    const response = await axios.get(
      `https://api.twitch.tv/helix/${endpoint}`,
      {
        headers: {
          'Client-ID': process.env.TWITCH_CLIENT_ID,
          Authorization: `Bearer ${token}`,
        },
        params,
      }
    );

    return response.data;
  } catch (error) {
    console.error(
      `Twitch API request failed: ${endpoint}`,
      error.response?.data || error.message
    );
    throw error;
  }
}

export async function getChannelId(username) {
  const data = await makeApiRequest('users', { login: username });
  return data.data[0]?.id;
}

export async function getRecentVods(channelId, daysBack = 30) {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - daysBack);

  let allVods = [];
  let cursor = null;

  do {
    const params = {
      user_id: channelId,
      type: 'archive',
      first: 100,
    };

    if (cursor) {
      params.after = cursor;
    }

    const data = await makeApiRequest('videos', params);

    const recentVods = data.data.filter((vod) => {
      const vodDate = new Date(vod.created_at);
      return vodDate >= cutoffDate;
    });

    allVods.push(...recentVods);

    if (data.data.length < 100 || recentVods.length < data.data.length) {
      break;
    }

    cursor = data.pagination?.cursor;
  } while (cursor);

  return allVods;
}

export async function getVodDetails(vodId) {
  const data = await makeApiRequest('videos', { id: vodId });
  return data.data[0];
}

export async function getMutedSegments(vodId) {
  try {
    const token = await getAccessToken();
    const response = await axios.get(
      `https://api.twitch.tv/v5/videos/${vodId}`,
      {
        headers: {
          'Client-ID': process.env.TWITCH_CLIENT_ID,
          Authorization: `OAuth ${token}`,
          Accept: 'application/vnd.twitchtv.v5+json',
        },
      }
    );

    return response.data.muted_segments || [];
  } catch (error) {
    console.error(
      `Failed to get muted segments for VOD ${vodId}:`,
      error.response?.data || error.message
    );
    return [];
  }
}
