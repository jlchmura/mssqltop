// Settings shared by the demo scripts; override with the same environment variables as demo/compose.yaml.
export const PORT = process.env.MSSQLTOP_DEMO_PORT ?? '14330';
export const SERVER = `localhost,${PORT}`;
export const PASSWORD = process.env.MSSQLTOP_DEMO_PASSWORD ?? 'Demo!Passw0rd';
export const DRIVER = process.env.MSSQLTOP_DEMO_DRIVER ?? 'ODBC Driver 18 for SQL Server';
