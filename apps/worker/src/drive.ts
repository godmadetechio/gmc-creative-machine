// Google Drive delivery for generated creatives — warn-and-skip by design:
// a missing/broken Drive setup must never fail a generation run (the files
// are already safe in Supabase Storage).
//
// Auth: OAuth refresh-token flow (GOOGLE_DRIVE_CLIENT_ID / _CLIENT_SECRET /
// _REFRESH_TOKEN in .env.local), plain fetch — no googleapis dependency.

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const UPLOAD_URL =
  "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink";

export type DriveConfig = {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
};

export function getDriveConfig(): DriveConfig | null {
  const clientId = process.env.GOOGLE_DRIVE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_DRIVE_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_DRIVE_REFRESH_TOKEN;
  if (!clientId || !clientSecret || !refreshToken) return null;
  return { clientId, clientSecret, refreshToken };
}

async function getAccessToken(config: DriveConfig): Promise<string> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      refresh_token: config.refreshToken,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) {
    throw new Error(`Drive token refresh failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
  }
  const json = (await res.json()) as { access_token?: string };
  if (!json.access_token) throw new Error("Drive token refresh returned no access_token");
  return json.access_token;
}

export type DriveUpload = { id: string; webViewLink: string | null };

// Creates a Drive client bound to one access token (fetched once per run).
export async function createDriveUploader(config: DriveConfig): Promise<{
  upload(name: string, mimeType: string, data: Buffer, folderId: string): Promise<DriveUpload>;
}> {
  const accessToken = await getAccessToken(config);
  return {
    async upload(name, mimeType, data, folderId) {
      const boundary = "gmc-drive-boundary";
      const metadata = JSON.stringify({ name, parents: [folderId] });
      const body = Buffer.concat([
        Buffer.from(
          `--${boundary}\r\ncontent-type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n` +
            `--${boundary}\r\ncontent-type: ${mimeType}\r\n\r\n`,
        ),
        data,
        Buffer.from(`\r\n--${boundary}--`),
      ]);
      const res = await fetch(UPLOAD_URL, {
        method: "POST",
        headers: {
          authorization: `Bearer ${accessToken}`,
          "content-type": `multipart/related; boundary=${boundary}`,
        },
        body,
      });
      if (!res.ok) {
        throw new Error(`Drive upload failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
      }
      const json = (await res.json()) as { id: string; webViewLink?: string };
      return { id: json.id, webViewLink: json.webViewLink ?? null };
    },
  };
}
