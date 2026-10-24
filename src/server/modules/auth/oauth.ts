/**
 * Discord OAuth2 (scope `identify email`). Chỉ phần nói chuyện với Discord;
 * route callback và phiên đăng nhập nằm ở nơi khác. `fetchFn` tiêm được để test
 * không chạm mạng.
 */

import type { Config } from '../../config.js';

export interface OAuthProfile {
  discordId: string;
  email: string | null;
  /** Discord đã xác minh email này (chỉ email như vậy mới được lưu vào hồ sơ). */
  emailVerified: boolean;
}

export interface OAuthClient {
  /** URL đưa người dùng sang Discord để cấp quyền; `state` chống giả mạo callback. */
  authorizeUrl(state: string): string;
  /** Đổi `code` từ callback lấy hồ sơ người dùng. Ném lỗi khi Discord từ chối. */
  exchange(code: string): Promise<OAuthProfile>;
}

const AUTHORIZE_URL = 'https://discord.com/oauth2/authorize';
const TOKEN_URL = 'https://discord.com/api/oauth2/token';
const USER_URL = 'https://discord.com/api/users/@me';

/** `${publicUrl}/auth/callback`, chịu được publicUrl có dấu `/` cuối. */
export function oauthCallbackUrl(config: Pick<Config, 'publicUrl'>): string {
  return `${config.publicUrl.replace(/\/+$/, '')}/auth/callback`;
}

export function createDiscordOAuthClient(config: Config, fetchFn: typeof fetch = fetch): OAuthClient {
  const { clientId, clientSecret } = config.discord;
  const redirectUri = oauthCallbackUrl(config);

  return {
    authorizeUrl(state) {
      const params = new URLSearchParams({
        client_id: clientId,
        response_type: 'code',
        redirect_uri: redirectUri,
        scope: 'identify email',
        state,
        prompt: 'none',
      });
      return `${AUTHORIZE_URL}?${params.toString()}`;
    },

    async exchange(code) {
      const tokenRes = await fetchFn(TOKEN_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          grant_type: 'authorization_code',
          code,
          redirect_uri: redirectUri,
        }).toString(),
      });
      const token = await readJsonObject(tokenRes, 'oauth2/token');
      const accessToken = token['access_token'];
      if (typeof accessToken !== 'string' || accessToken === '') {
        throw new Error('Discord không trả access_token');
      }

      const userRes = await fetchFn(USER_URL, { headers: { authorization: `Bearer ${accessToken}` } });
      const user = await readJsonObject(userRes, 'users/@me');
      const id = user['id'];
      if (typeof id !== 'string' || id === '') throw new Error('Discord không trả id người dùng');

      const email = user['email'];
      return {
        discordId: id,
        email: typeof email === 'string' && email !== '' ? email : null,
        emailVerified: user['verified'] === true,
      };
    },
  };
}

async function readJsonObject(res: Response, what: string): Promise<Record<string, unknown>> {
  if (!res.ok) throw new Error(`Discord ${what} trả về HTTP ${res.status}`);
  const body: unknown = await res.json();
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new Error(`Discord ${what} trả về dữ liệu không phải object`);
  }
  return body as Record<string, unknown>;
}
