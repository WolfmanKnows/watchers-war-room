import { cached } from "@/lib/cache";
import { loadDeskSnapshot } from "@/lib/desk";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET() {
  try {
    const snapshot = await cached("desk", 18_000, loadDeskSnapshot);
    return Response.json(snapshot, {
      headers: {
        "Cache-Control": "public, s-maxage=15, stale-while-revalidate=20",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "desk snapshot failed";
    return Response.json({ error: message }, { status: 502 });
  }
}
