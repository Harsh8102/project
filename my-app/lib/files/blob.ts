import { put, head } from "@vercel/blob";

export type UploadedBlob = {
  url: string; // Blob's own URL — not directly browser-fetchable on a private store
  pathname: string; // stable key, used to build our own /api/files proxy route
  contentType?: string;
};

/**
 * Uploads a file to Vercel Blob. The project's store is configured as
 * **private** (Vercel's current default), so nothing here is a public URL —
 * anything the browser needs to open (downloads, the source-viewer trust
 * feature) goes through a server-side proxy route that holds the token,
 * built from `pathname`.
 */
export async function uploadToBlob(
  pathname: string,
  body: Buffer | Blob | string,
  contentType?: string
): Promise<UploadedBlob> {
  const blob = await put(pathname, body, {
    access: "private",
    addRandomSuffix: true,
    contentType,
    token: process.env.BLOB_READ_WRITE_TOKEN,
  });
  return { url: blob.url, pathname: blob.pathname, contentType };
}

/** Server-side read of a private blob's metadata (used by the file-proxy route). */
export async function getBlobMetadata(url: string) {
  return head(url, { token: process.env.BLOB_READ_WRITE_TOKEN });
}
