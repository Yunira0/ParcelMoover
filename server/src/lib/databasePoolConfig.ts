type Environment = Record<string, string | undefined>;

function integerSetting(env: Environment, key: string, fallback: number, minimum = 1) {
  const raw = env[key]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!/^\d+$/.test(raw) || !Number.isSafeInteger(value) || value < minimum || value > 2_147_483_647) {
    throw new Error(`${key} must be a whole number from ${minimum} to 2147483647`);
  }
  return value;
}

// Fail at startup on an invalid setting instead of silently falling back to a
// pool of 60. A budget is optional: only an operator knows the deployment size
// and how many connections must remain available to other services/admins.
export function readDatabasePoolConfig(env: Environment) {
  const max = integerSetting(env, "DB_POOL_MAX", 60);
  const budgetSet = !!env.DB_CONNECTION_BUDGET?.trim();
  const processesSet = !!env.DB_APP_PROCESSES?.trim();
  if (budgetSet !== processesSet) {
    throw new Error("DB_CONNECTION_BUDGET and DB_APP_PROCESSES must be set together");
  }
  if (budgetSet) {
    const budget = integerSetting(env, "DB_CONNECTION_BUDGET", 1);
    const processes = integerSetting(env, "DB_APP_PROCESSES", 1);
    if (max * processes > budget) {
      throw new Error("DB_POOL_MAX × DB_APP_PROCESSES exceeds DB_CONNECTION_BUDGET");
    }
  }
  return {
    max,
    idleTimeoutMillis: integerSetting(env, "DB_POOL_IDLE_TIMEOUT_MS", 30_000, 0),
    connectionTimeoutMillis: integerSetting(env, "DB_POOL_CONNECTION_TIMEOUT_MS", 5_000),
    idleInTransactionTimeoutMs: integerSetting(env, "DB_IDLE_IN_TRANSACTION_TIMEOUT_MS", 30_000, 0),
  };
}
