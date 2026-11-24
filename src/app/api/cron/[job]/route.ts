import { timingSafeEqual } from "node:crypto";
import { runJob } from "@/server/jobs/run";

/** True only when CRON_SECRET is set and the request carries exactly `Bearer <CRON_SECRET>` (Vercel Cron). */
function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return false;
  const given = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** Scheduled jobs (see vercel.json): `frequent` every 5 minutes, `daily` once a day. */
export async function GET(request: Request, ctx: { params: Promise<{ job: string }> }): Promise<Response> {
  if (!authorized(request)) return new Response("unauthorized", { status: 401 });
  const { job } = await ctx.params;
  const summary = await runJob(job);
  if (!summary) return new Response("not found", { status: 404 });
  return Response.json(summary);
}
