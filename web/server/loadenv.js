// Load .env BEFORE anything else. ES modules evaluate imports depth-first in
// source order, so any module that reads process.env at import time (e.g.
// ai/settings.js seeding secrets) would run before a later `dotenv.config()`.
// Importing this file as the very first import in the entrypoint guarantees the
// .env values are present when those modules initialise.
import dotenv from "dotenv";
dotenv.config();
