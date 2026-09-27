/** Splits the terminal between the header, charts, the two panels and the footer. */

export interface LayoutInput {
	width: number;
	height: number;
	showCharts: boolean;
	maximized: boolean;
	focus: 'processes' | 'queries';
}

export interface Layout {
	chartsVisible: boolean;
	chartHeight: number;
	/** Widths of the four charts; they always sum to the terminal width. */
	chartWidths: [number, number, number, number];
	processesHeight: number;
	queriesHeight: number;
	/** Height available to a full-screen overlay (everything between header and footer). */
	overlayHeight: number;
}

const HEADER_ROWS = 1;
const FOOTER_ROWS = 1;
/** Charts are hidden below this terminal height so the grids keep usable space. */
export const MIN_HEIGHT_FOR_CHARTS = 24;
const PROCESSES_SHARE = 0.55;
const MIN_PANEL_ROWS = 6;
/** Frame title line + bottom border + column header. */
export const PANEL_CHROME_ROWS = 3;

export function computeLayout({width, height, showCharts, maximized, focus}: LayoutInput): Layout {
	const chartsVisible = showCharts && !maximized && height >= MIN_HEIGHT_FOR_CHARTS;
	const chartHeight = chartsVisible ? Math.max(7, Math.min(12, Math.round(height * 0.2))) : 0;
	const body = Math.max(0, height - HEADER_ROWS - FOOTER_ROWS - chartHeight);
	let processesHeight = Math.min(body, Math.max(MIN_PANEL_ROWS, Math.round(body * PROCESSES_SHARE)));
	if (maximized) processesHeight = focus === 'processes' ? body : 0;
	const chartW = Math.floor(width / 4);
	return {
		chartsVisible,
		chartHeight,
		chartWidths: [chartW, chartW, chartW, width - chartW * 3],
		processesHeight,
		queriesHeight: body - processesHeight,
		overlayHeight: Math.max(0, height - HEADER_ROWS - FOOTER_ROWS),
	};
}

/** Data rows visible in a panel of the given height. */
export const visibleRows = (panelHeight: number): number => Math.max(1, panelHeight - PANEL_CHROME_ROWS);
