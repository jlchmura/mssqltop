#!/usr/bin/env node
// React's development build records a performance.measure() entry for every render, and Node keeps those
// forever: a long-running session runs out of memory within hours. The production build has to be chosen
// before React is first imported, so this entry point sets it and only then loads the app.
process.env.NODE_ENV = 'production';

await import('./main.js');
