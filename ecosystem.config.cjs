const ROOT = __dirname;
const ENV  = `${ROOT}/.env`;

function app(name, workerPath) {
  const cwd = `${ROOT}/${workerPath}`;
  return {
    name,
    script:           "src/index.ts",
    interpreter:      "node",
    interpreter_args: `--env-file=${ENV} --import tsx`,
    cwd,
    autorestart:     true,
    restart_delay:   5000,
    max_restarts:    20,
    watch:           false,
    log_date_format: "YYYY-MM-DD HH:mm:ss",
  };
}

module.exports = {
  apps: [
    app("indexer",   "apps/workers/indexer"),
    app("router",    "apps/workers/router"),
    app("keeper",    "apps/workers/keeper"),
    app("trader-01", "apps/workers/agents/trader-01"),
    app("trader-02", "apps/workers/agents/trader-02"),
    app("trader-03", "apps/workers/agents/trader-03"),
    app("trader-04", "apps/workers/agents/trader-04"),
  ],
};
