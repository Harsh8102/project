import { NextRequest, NextResponse } from "next/server";

// Proxies a private Blob URL to the browser, holding the read token
// server-side. Every downloadable/viewable file in the app goes through
// this route rather than a direct Blob URL (§6.3 of the architecture plan —
// the store is private, so direct URLs aren't browser-fetchable).
export async function GET(request: NextRequest) {
  const blobUrl = request.nextUrl.searchParams.get("url");
  if (!blobUrl) {
    return NextResponse.json({ error: "Missing url query param" }, { status: 400 });
  }

  // Only ever proxy our own Blob store, never an arbitrary URL a client passes in.
  if (!blobUrl.includes(".blob.vercel-storage.com/")) {
    return NextResponse.json({ error: "Invalid blob url" }, { status: 400 });
  }

  const upstream = await fetch(blobUrl, {
    headers: { authorization: `Bearer ${process.env.BLOB_READ_WRITE_TOKEN}` },
  });

  if (!upstream.ok || !upstream.body) {
    return NextResponse.json({ error: "Failed to fetch file" }, { status: upstream.status || 502 });
  }

  return new NextResponse(upstream.body, {
    status: 200,
    headers: {
      "content-type": upstream.headers.get("content-type") ?? "application/octet-stream",
      "content-disposition": upstream.headers.get("content-disposition") ?? "inline",
      "cache-control": "private, max-age=60",
    },
  });
}
