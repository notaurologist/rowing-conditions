import { createDeployedApp } from './bootstrap.ts';

// Vercel's entry point (vercel.json). An invalid environment is logged and the function fails
// to start, so no request is served with a bad configuration.
export default createDeployedApp(process.env);
