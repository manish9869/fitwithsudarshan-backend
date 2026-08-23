// Vercel serverless entry point. vercel.json rewrites all /api/(.*) traffic
// here (functions: { "api/**" }) — Express apps are directly callable as
// (req, res) handlers, so re-exporting the app is all this needs to do.
import app from '../src/app.js';

export default app;
