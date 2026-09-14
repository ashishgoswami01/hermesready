import { NextResponse, type NextRequest } from "next/server";

/**
 * HTTP Basic auth over /admin and /api (Next.js 16 proxy convention).
 *
 * These routes read and write the knowledge bank through the service-role key,
 * so leaving them open on a public Vercel URL would hand anyone the settings
 * form and the sync trigger. Set ADMIN_USER / ADMIN_PASSWORD to lock it; the
 * cron route authenticates with CRON_SECRET instead and is skipped here.
 */

export const config = {
  matcher: ["/admin/:path*", "/api/:path*"],
};

export default function proxy(req: NextRequest) {
  if (req.nextUrl.pathname.startsWith("/api/cron/")) return NextResponse.next();

  const user = process.env.ADMIN_USER ?? "hermes";
  const password = process.env.ADMIN_PASSWORD;

  // No password configured — run open rather than lock Ashish out of his own
  // deployment, but make the gap visible in the response headers.
  if (!password) {
    const res = NextResponse.next();
    res.headers.set("x-hermes-auth", "disabled");
    return res;
  }

  const header = req.headers.get("authorization");
  if (header?.startsWith("Basic ")) {
    try {
      const [u, p] = atob(header.slice(6)).split(":");
      if (u === user && p === password) return NextResponse.next();
    } catch {
      /* fall through to the challenge */
    }
  }

  // API callers get JSON; a browser gets the password prompt.
  if (req.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return new NextResponse("Authentication required", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="Hermes Control Center"' },
  });
}
