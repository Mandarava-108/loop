import { NextResponse, type NextRequest } from "next/server";

// Checks whether a site can be embedded in an iframe on this app's domain,
// by inspecting X-Frame-Options and CSP frame-ancestors response headers.
// Returns { blocked: true | false | null } — null means the site was unreachable.
export async function GET(request: NextRequest) {
  const raw = request.nextUrl.searchParams.get("url");
  let url: URL;
  try {
    url = new URL(raw ?? "");
  } catch {
    return NextResponse.json({ blocked: null, reason: "invalid-url" });
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return NextResponse.json({ blocked: null, reason: "invalid-url" });
  }

  const fetchOpts = (method: "HEAD" | "GET") => ({
    method,
    redirect: "follow" as const,
    signal: AbortSignal.timeout(8000),
    headers: { "user-agent": "Mozilla/5.0 (compatible; LoopFrameCheck/1.0)" },
  });

  let res: Response;
  try {
    res = await fetch(url, fetchOpts("HEAD"));
    if (res.status === 405 || res.status === 501) {
      res = await fetch(url, fetchOpts("GET"));
    }
  } catch {
    return NextResponse.json({ blocked: null, reason: "unreachable" });
  }

  const xfo = res.headers.get("x-frame-options")?.toLowerCase() ?? "";
  if (xfo.includes("deny") || xfo.includes("sameorigin")) {
    return NextResponse.json({ blocked: true, reason: "x-frame-options" });
  }

  const csp = res.headers.get("content-security-policy")?.toLowerCase() ?? "";
  const match = csp.match(/frame-ancestors([^;]*)/);
  if (match) {
    const allowed = match[1];
    const ourHost = request.nextUrl.host.toLowerCase();
    const permitsUs =
      allowed.includes("*") ||
      allowed.includes(ourHost) ||
      allowed.includes("https:");
    if (!permitsUs) {
      return NextResponse.json({ blocked: true, reason: "frame-ancestors" });
    }
  }

  return NextResponse.json({ blocked: false, reason: null });
}
