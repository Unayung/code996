/**
 * 報表打印器統一導出入口
 * 所有打印功能已拆分到 printers/ 子目錄中
 * 此文件保持向後相容，重新導出所有打印函數
 */

export { printCoreResults, type TimeRangeMode } from './printers/core-printer'

export { printTimeDistribution } from './printers/time-distribution-printer'

export { printWorkTimeSummary } from './printers/work-time-printer'

export { printWeekdayOvertime, printWeekendOvertime, printLateNightAnalysis } from './printers/overtime-printer'
