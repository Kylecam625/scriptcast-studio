import os from "node:os";
import path from "node:path";

process.env.SCRIPTCAST_MOCK_MODE = "true";
process.env.SCRIPTCAST_STORAGE_DIR = path.join(os.tmpdir(), "scriptcast-vitest", String(process.pid));
