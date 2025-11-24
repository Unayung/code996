import chalk from 'chalk'
import { ParsedGitData } from '../../../../types/git-types'
import { getTerminalWidth, createAdaptiveTable } from '../../../../utils/terminal'
import { formatStartClock, formatEndClock } from '../../../../utils/formatter'

const MAX_STANDARD_WORK_HOURS = 9

/**
 * 工作時間打印器
 * 負責打印工作時間推測和相關說明
 */

/** 打印上班與下班時間的推測資訊 */
export function printWorkTimeSummary(parsedData: ParsedGitData): void {
  const detection = parsedData.detectedWorkTime
  if (!detection) {
    console.log(chalk.cyan.bold('⌛ 工作時間推測:'))
    console.log('暫無可用的工作時間推測資料')
    console.log()
    return
  }

  if (detection.detectionMethod === 'manual') {
    // 使用者已通過 --hours 指定標準工時，這裡直接跳過推測模块以避免重复資訊
    printWorkHourCapNotice(detection)
    return
  }

  // 如果置信度低于40%，不顯示工作時間推測（但仍然顯示加班說明）
  if (detection.confidence < 40) {
    printWorkHourCapNotice(detection)
    return
  }

  // 只在自動推斷场景展示該模块，因此固定輸出自動提示
  const titleSuffix = chalk.gray('（自動推斷）')
  console.log(chalk.cyan.bold('⌛ 工作時間推測:') + ' ' + titleSuffix)

  const startClock = formatStartClock(detection)
  const endClock = formatEndClock(detection)

  const terminalWidth = Math.min(getTerminalWidth(), 80)
  const workTimeTable = createAdaptiveTable(terminalWidth, 'core')

  workTimeTable.push(
    [
      { content: chalk.bold('上班時間'), colSpan: 1 },
      { content: startClock, colSpan: 1 },
    ],
    [
      { content: chalk.bold('下班時間'), colSpan: 1 },
      { content: endClock, colSpan: 1 },
    ],
    [
      { content: chalk.bold('置信度'), colSpan: 1 },
      {
        content: `${detection.confidence}%（樣本天數: ${detection.sampleCount >= 0 ? detection.sampleCount : '手动'}）`,
        colSpan: 1,
      },
    ]
  )

  console.log(workTimeTable.toString())
  console.log()

  printWorkHourCapNotice(detection)
}

// 當推測/指定的工作時段超過 9 小時時，告知使用者超出的部分已按加班計算
function printWorkHourCapNotice(detection: ParsedGitData['detectedWorkTime']): void {
  if (!detection) {
    return
  }

  const actualSpan = detection.endHour - detection.startHour
  if (actualSpan <= MAX_STANDARD_WORK_HOURS) {
    return
  }

  const spanText = actualSpan.toFixed(1)
  console.log(
    chalk.yellow(
      `⚠️  加班判定說明：推測的平均工作時长約為 ${spanText} 小時，指數計算僅將前9小時视為正常工時，超出時段已按加班統計。`
    )
  )
  console.log()
}
