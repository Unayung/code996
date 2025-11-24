import Table from 'cli-table3'

/**
 * 獲取終端宽度，設定合理範圍
 * @returns 終端宽度（字符數）
 */
export function getTerminalWidth(): number {
  try {
    // 獲取終端宽度，設定合理範圍
    const width = process.stdout.columns || 80
    return Math.max(40, Math.min(width, 200)) // 限制在40-200字符之間，支援更窄的終端
  } catch {
    return 80 // 降级方案
  }
}

/**
 * 計算時間範圍，預設為最近一年
 * @param allTime 是否查詢所有時間
 * @returns { since: string, until: string }
 */
export function calculateTimeRange(allTime: boolean = false): { since: string; until: string } {
  if (allTime) {
    return {
      since: '1970-01-01', // Unix紀元開始
      until: '2100-01-01', // 远期日期
    }
  }

  const today = new Date()
  const oneYearAgo = new Date()
  oneYearAgo.setFullYear(today.getFullYear() - 1)

  // 格式化為YYYY-MM-DD
  const since = oneYearAgo.toISOString().split('T')[0]
  const until = today.toISOString().split('T')[0]

  return { since, until }
}

/**
 * 計算趨勢報告表格列宽（10列表头），根據終端宽度自適應
 * @param terminalWidth 終端宽度
 * @returns 10列宽度陣列
 */
export function calculateTrendTableWidths(terminalWidth: number): number[] {
  const columnCount = 10
  const baseWidths = [9, 10, 10, 10, 10, 10, 8, 10, 12, 10] // 月份、指數、平均工時、平均開始、平均結束、最晚結束、提交數、参與人數、工作天數、置信度
  const minColumnWidth = 3

  // 估算边框和分隔線占用：列間分隔線(columnCount-1) + 左右边框2，共 columnCount 個字符
  const borderOverhead = columnCount
  const availableWidth = Math.max(terminalWidth - borderOverhead, columnCount)

  const baseTotal = baseWidths.reduce((sum, width) => sum + width, 0)

  // 如果基础宽度總和超過可用宽度，需要压缩
  if (baseTotal > availableWidth) {
    const scale = availableWidth / baseTotal
    let widths = baseWidths.map((width) => Math.max(minColumnWidth, Math.floor(width * scale)))
    let currentSum = widths.reduce((sum, width) => sum + width, 0)

    // 如果超過可用宽度，則在不低于最小值的前提下依次回收
    let index = 0
    let safetyGuard = columnCount * 10 // 防止極端情況下死循環
    while (currentSum > availableWidth && safetyGuard > 0) {
      const col = index % columnCount
      if (widths[col] > minColumnWidth) {
        widths[col]--
        currentSum--
      }
      index++
      safetyGuard--
    }
    return widths
  }

  // 基础宽度適合，直接使用，不再扩展填滿
  return baseWidths
}

/**
 * 创建自適應表格
 * @param terminalWidth 終端宽度
 * @param tableType 表格類型
 * @param options 表格選項
 * @param customColWidths 手动指定的列宽陣列，可涵蓋預設計算結果
 * @returns Table實例
 */
export function createAdaptiveTable(
  terminalWidth: number,
  tableType: 'core' | 'stats' | 'time',
  options: any = {},
  customColWidths?: number[]
): any {
  const defaultOptions = {
    chars: {
      top: '═',
      'top-mid': '╤',
      'top-left': '╔',
      'top-right': '╗',
      bottom: '═',
      'bottom-mid': '╧',
      'bottom-left': '╚',
      'bottom-right': '╝',
      left: '║',
      'left-mid': '╟',
      mid: '─',
      'mid-mid': '┼',
      right: '║',
      'right-mid': '╢',
      middle: '│',
    },
    style: { 'padding-left': 1, 'padding-right': 1 },
    wordWrap: true,
    wrapOnWordBoundary: true,
    truncate: '',
  }

  const colWidths =
    customColWidths && customColWidths.length > 0
      ? customColWidths
      : calculatePresetTableWidths(tableType, terminalWidth) // 按類型獲取預設列宽，自動處理兜底逻辑

  return new Table({
    ...defaultOptions,
    ...options,
    // 確保 wordWrap / wrapOnWordBoundary / truncate 使用統一預設值
    wordWrap: options.wordWrap !== undefined ? options.wordWrap : defaultOptions.wordWrap,
    wrapOnWordBoundary:
      options.wrapOnWordBoundary !== undefined ? options.wrapOnWordBoundary : defaultOptions.wrapOnWordBoundary,
    truncate: options.truncate !== undefined ? options.truncate : defaultOptions.truncate,
    colWidths,
  })
}

/**
 * 統一計算 core/stats/time 三種表格的列宽，並為未知類型提供兜底方案，避免重复逻辑
 * @param tableType 表格類型
 * @param terminalWidth 終端宽度
 */
function calculatePresetTableWidths(tableType: 'core' | 'stats' | 'time' | string, terminalWidth: number): number[] {
  if (tableType === 'time') {
    // 時間分布表格：保留固定的時間列，剩余宽度用於進度條
    const fixedOverhead = 5
    const availableWidth = terminalWidth - fixedOverhead
    const timeColumnWidth = 5
    const barColumnWidth = availableWidth - timeColumnWidth
    return [timeColumnWidth, barColumnWidth]
  }

  if (tableType === 'core' || tableType === 'stats') {
    // core/stats 都是双列結構，差別僅在標籤列的約束
    const config =
      tableType === 'core'
        ? { labelMin: 15, labelRatioMax: 0.25, labelHardMax: 20 }
        : { labelMin: 20, labelRatioMax: 0.4, labelHardMax: 25 }

    return calculateTwoColumnWidths(terminalWidth, config)
  }

  // 未知類型預設退回到通用的双列表配置，保證不會抛異常
  return [15, 70]
}

/**
 * 統一的兩列表布局計算函數，避免重复逻辑
 * @param terminalWidth 終端宽度
 * @param options 列宽配置
 * @returns 列宽陣列
 */
function calculateTwoColumnWidths(
  terminalWidth: number,
  options: { labelMin: number; labelRatioMax: number; labelHardMax: number }
): number[] {
  // 固定边框和間距占用：左右边框2個字符 + 内边距2個字符 + 分隔符1個字符 = 5字符
  const fixedOverhead = 5
  const availableWidth = terminalWidth - fixedOverhead

  const labelColumnMaxByRatio = Math.floor(availableWidth * options.labelRatioMax)
  const labelColumnWidth = Math.max(options.labelMin, Math.min(labelColumnMaxByRatio, options.labelHardMax))

  const valueColumnWidth = availableWidth - labelColumnWidth
  return [labelColumnWidth, valueColumnWidth]
}
