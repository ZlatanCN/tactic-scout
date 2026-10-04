# Add reproducible build checks for the public repository

Type: task
Status: claimed
Labels: ready-for-agent

## Goal

Run the same deterministic API and web production builds on GitHub for every push and pull request, using the checked-in lockfile and a supported Node/pnpm toolchain.

## Acceptance criteria

- [x] A GitHub Actions workflow is configured for pushes, pull requests, and manual dispatch.
- [x] Dependency installation uses `pnpm install --frozen-lockfile` with Node.js 22 and pinned pnpm 12.6.0.
- [x] The workflow builds both the API and web application without requiring `.env`, provider credentials, or a running Ollama service.
- [x] The workflow receives only read access to repository contents.
- [x] The README does not claim CI passes before a remote run reports success.

## Comments

- 2026-10-04：公开仓库尚无自动构建检查；增加无凭据的生产构建工作流，让基础可复现性可在每个 PR 上核验。
- 2026-10-04：按 [pnpm/setup 官方说明](https://github.com/pnpm/setup) 使用当前 v3 action 配置 Node.js 与 pnpm；该 action 支持 pnpm 11+，本项目锁定 pnpm 12.6.0，并在单独步骤显式执行 frozen-lockfile 安装。checkout 使用 [actions/checkout 官方仓库](https://github.com/actions/checkout) 当前 v7。

## Answer

工作流已在本地准备并通过 YAML 解析和差异格式检查；推送后仍需核实首个远端 Actions 运行结果。
