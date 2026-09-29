/**
 * Whether this process should run singleton work such as @Cron jobs.
 *
 * In cluster mode (see main.ts, CLUSTER_WORKERS) every worker process loads
 * the same AppModule, so @nestjs/schedule would otherwise register — and
 * fire — the same cron job once per worker. Only the process the primary
 * assigned CLUSTER_WORKER_ID=1 is the leader; outside cluster mode the env
 * var is unset, so the single process is always the leader.
 */
export function isCronLeader(): boolean {
  const workerId = process.env.CLUSTER_WORKER_ID;
  return !workerId || workerId === '1';
}
