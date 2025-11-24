import chalk from 'chalk'
import { TrendAnalysisResult, MonthlyTrendData } from '../../../types/git-types'
import { getTerminalWidth, createAdaptiveTable, calculateTrendTableWidths } from '../../../utils/terminal'
import { getIndexColor } from '../../../utils/formatter'

/**
 * 打印月度趨勢分析報告
 */
export function printTrendReport(result: TrendAnalysisResult): void {
  console.log()
  console.log(chalk.cyan.bold('📈 月度趨勢分析報告'))
  console.log()

  // 打印時間範圍
  console.log(chalk.gray(`分析時段: ${result.timeRange.since} 至 ${result.timeRange.until}`))
  console.log(chalk.gray(`總計月份: ${result.summary.totalMonths} 個月`))
  console.log()

  // 打印月度資料表格
  printMonthlyTable(result.monthlyData)

  // 打印趨勢摘要
  printTrendSummary(result)

  // 打印資料說明
  printDataQualityLegend()
}

/**
 * 打印月度資料表格
 */
function printMonthlyTable(monthlyData: MonthlyTrendData[]): void {
  const terminalWidth = Math.min(getTerminalWidth(), 120)
  // 根據終端宽度动態計算10列表格的列宽，避免窄終端溢出
  const adaptiveColWidths = calculateTrendTableWidths(terminalWidth)
  const table = createAdaptiveTable(terminalWidth, 'stats', {}, adaptiveColWidths)

  // 表头（支援兩行顯示）
  table.push([
    { content: chalk.bold('月份'), hAlign: 'center' },
    { content: chalk.bold('996指數'), hAlign: 'center' },
    { content: chalk.bold('平均工時'), hAlign: 'center' },
    { content: chalk.bold('開始提交\n(平均)'), hAlign: 'center' },
    { content: chalk.bold('結束提交\n(平均)'), hAlign: 'center' },
    { content: chalk.bold('結束提交\n(最晚)'), hAlign: 'center' },
    { content: chalk.bold('提交數'), hAlign: 'center' },
    { content: chalk.bold('参與人數'), hAlign: 'center' },
    { content: chalk.bold('工作天數'), hAlign: 'center' },
    { content: chalk.bold('置信度'), hAlign: 'center' },
  ])

  // 資料行
  for (const data of monthlyData) {
    const indexColor = getIndexColor(data.index996)
    const confidenceMark = getConfidenceMark(data.confidence)

    // 格式化資料
    const index996Text = data.totalCommits > 0 ? data.index996.toFixed(1) : '--'
    const avgWorkSpanText = data.totalCommits > 0 ? `${data.avgWorkSpan.toFixed(1)}h` : '--'
    const avgStartTimeText = data.avgStartTime
    const avgEndTimeText = data.avgEndTime
    const latestEndTimeText = data.latestEndTime
    const totalCommitsText = data.totalCommits.toString()
    const contributorsText = data.contributors.toString()
    const workDaysText = `${data.workDays}天`

    table.push([
      { content: data.month, hAlign: 'center' },
      { content: indexColor(index996Text), hAlign: 'center' },
      { content: avgWorkSpanText, hAlign: 'center' },
      { content: chalk.green(avgStartTimeText), hAlign: 'center' },
      { content: chalk.cyan(avgEndTimeText), hAlign: 'center' },
      { content: chalk.yellow(latestEndTimeText), hAlign: 'center' },
      { content: totalCommitsText, hAlign: 'center' },
      { content: chalk.magenta(contributorsText), hAlign: 'center' },
      { content: workDaysText, hAlign: 'center' },
      { content: confidenceMark, hAlign: 'center' },
    ])
  }

  console.log(table.toString())
  console.log()
}

/**
 * 打印趨勢摘要
 */
function printTrendSummary(result: TrendAnalysisResult): void {
  console.log(chalk.cyan.bold('📊 整體趨勢:'))
  console.log()

  const terminalWidth = Math.min(getTerminalWidth(), 80)
  const summaryTable = createAdaptiveTable(terminalWidth, 'core')

  const avgIndexColor = getIndexColor(result.summary.avgIndex996)
  const trendText = getTrendText(result.summary.trend)
  const trendColor = getTrendColor(result.summary.trend)

  summaryTable.push(
    [
      { content: chalk.bold('平均996指數'), colSpan: 1 },
      { content: avgIndexColor(result.summary.avgIndex996.toFixed(1)), colSpan: 1 },
    ],
    [
      { content: chalk.bold('平均工作時长'), colSpan: 1 },
      { content: `${result.summary.avgWorkSpan.toFixed(1)} 小時`, colSpan: 1 },
    ],
    [
      { content: chalk.bold('趨勢方向'), colSpan: 1 },
      { content: trendColor(trendText), colSpan: 1 },
    ]
  )

  console.log(summaryTable.toString())
  console.log()
}

/**
 * 打印資料品質說明
 */
function printDataQualityLegend(): void {
  console.log(chalk.gray('置信度標記:'))
  console.log(chalk.gray('  ✓✓ 高置信 (提交≥100且天≥10) | ✓ 中置信 (提交≥50或天≥5) | ✗ 低置信'))
  console.log()
}

/**
 * 獲取置信度標記
 */
function getConfidenceMark(confidence: 'high' | 'medium' | 'low'): string {
  switch (confidence) {
    case 'high':
      return chalk.green('✓✓')
    case 'medium':
      return chalk.yellow('✓')
    case 'low':
      return chalk.red('✗')
  }
}

/**
 * 獲取趨勢文本
 */
function getTrendText(trend: 'increasing' | 'decreasing' | 'stable'): string {
  switch (trend) {
    case 'increasing':
      return '📈 加班趨勢上升'
    case 'decreasing':
      return '📉 加班趨勢下降'
    case 'stable':
      return '📊 保持稳定'
  }
}

/**
 * 獲取趨勢顏色
 */
function getTrendColor(trend: 'increasing' | 'decreasing' | 'stable'): (text: string) => string {
  switch (trend) {
    case 'increasing':
      return (text: string) => chalk.red(text)
    case 'decreasing':
      return (text: string) => chalk.green(text)
    case 'stable':
      return (text: string) => chalk.blue(text)
  }
}
