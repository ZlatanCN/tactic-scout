import { positionSelectionFixture } from "../../tests/fixtures/position-selection.js";
const { app } = positionSelectionFixture();
await app.listen({ host: "127.0.0.1", port: 8000 });
