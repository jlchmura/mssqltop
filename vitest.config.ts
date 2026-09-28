import {defineConfig} from 'vitest/config';

export default defineConfig({
	test: {
		include: ['src/**/*.test.{ts,tsx}'],
		// Ink output is colored when FORCE_COLOR is set in CI; tests compare plain text.
		env: {FORCE_COLOR: '0'},
		coverage: {
			include: ['src/**/*.{ts,tsx}'],
			exclude: ['src/**/*.test.{ts,tsx}', 'src/test/**', 'src/cli.ts', 'src/main.tsx'],
		},
	},
});
