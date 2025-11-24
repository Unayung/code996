import chalk from 'chalk'
import { ParsedGitData } from '../../../../types/git-types'

/**
 * 加班分析打印器
 * 負責打印工作日加班、週末加班和深夜加班分析
 */

/** 打印工作日加班分布 */
export function printWeekdayOvertime(parsedData: ParsedGitData): void {
  if (!parsedData.weekdayOvertime) {
    return
  }

  console.log(chalk.cyan.bold('💼 工作日加班分布:'))
  console.log()

  const overtime = parsedData.weekdayOvertime
  const weekdays = [
    { name: '週一', key: 'monday' as const },
    { name: '週二', key: 'tuesday' as const },
    { name: '週三', key: 'wednesday' as const },
    { name: '週四', key: 'thursday' as const },
    { name: '週五', key: 'friday' as const },
  ]

  // 找出最大值用於計算條形图长度
  const maxCount = Math.max(overtime.monday, overtime.tuesday, overtime.wednesday, overtime.thursday, overtime.friday)

  if (maxCount === 0) {
    console.log('暫無工作日加班資料')
    console.log()
    return
  }

  const barLength = 20

  // 計算加班高峰閾值（最大值的90%）
  const peakThreshold = maxCount * 0.9

  weekdays.forEach(({ name, key }) => {
    const count = overtime[key]
    const percentage = maxCount > 0 ? (count / maxCount) * barLength : 0
    const filledLength = Math.min(barLength, Math.max(0, Math.round(percentage)))
    const bar = '█'.repeat(filledLength) + ' '.repeat(barLength - filledLength)
    const countText = count.toString().padStart(3)

    // 如果加班次數 >= 90% 的最大值，標注為加班高峰
    const isPeak = count >= peakThreshold && count > 0
    const peakLabel = isPeak ? chalk.red(' ⚠️ 加班高峰') : ''

    console.log(`${name}: ${bar} ${countText}次${peakLabel}`)
  })

  console.log()
}

/** 打印週末加班分布 */
export function printWeekendOvertime(parsedData: ParsedGitData): void {
  if (!parsedData.weekendOvertime) {
    return
  }

  const weekend = parsedData.weekendOvertime
  const totalDays = weekend.saturdayDays + weekend.sundayDays

  // 如果沒有週末工作，不顯示
  if (totalDays === 0) {
    return
  }

  console.log(chalk.cyan.bold('📅 週末加班分析:'))
  console.log()

  const weekendDays = [
    { name: '週六', count: weekend.saturdayDays },
    { name: '週日', count: weekend.sundayDays },
  ]

  const barLength = 20
  const maxCount = Math.max(weekend.saturdayDays, weekend.sundayDays)

  weekendDays.forEach(({ name, count }) => {
    if (count === 0) return

    const percentage = maxCount > 0 ? (count / maxCount) * barLength : 0
    const filledLength = Math.min(barLength, Math.max(0, Math.round(percentage)))
    const bar = '█'.repeat(filledLength) + ' '.repeat(barLength - filledLength)
    const countText = count.toString().padStart(3)
    const percentOfTotal = totalDays > 0 ? ((count / totalDays) * 100).toFixed(1) : '0.0'

    console.log(`${name}: ${bar} ${countText}天 (${percentOfTotal}%)`)
  })

  console.log()

  // 顯示加班類型分布
  const totalWorkDays = weekend.realOvertimeDays + weekend.casualFixDays
  const realOvertimeColor =
    weekend.realOvertimeDays > 15 ? chalk.red : weekend.realOvertimeDays > 8 ? chalk.yellow : chalk.green

  console.log('加班類型:')
  console.log(
    `  真正加班: ${realOvertimeColor(chalk.bold(weekend.realOvertimeDays.toString()))}天 (提交時間跨度>=3小時)`
  )
  console.log(`  暫時修复: ${chalk.gray(weekend.casualFixDays.toString())}天 (提交時間跨度<3小時)`)
  console.log(`  加班占比: ${realOvertimeColor(((weekend.realOvertimeDays / totalWorkDays) * 100).toFixed(1) + '%')}`)
  console.log()
}

/** 打印深夜加班分析 */
export function printLateNightAnalysis(parsedData: ParsedGitData): void {
  if (!parsedData.lateNightAnalysis) {
    return
  }

  console.log(chalk.cyan.bold('🌙 深夜加班分析:'))
  console.log()

  const analysis = parsedData.lateNightAnalysis
  const endHour = parsedData.detectedWorkTime?.endHour || 18

  // 計算最大值用於條形图
  const maxCount = Math.max(analysis.evening, analysis.lateNight, analysis.midnight, analysis.dawn)

  if (maxCount === 0) {
    console.log('暫無深夜加班資料')
    console.log()
    return
  }

  const barLength = 20

  const timeRanges = [
    {
      label: `${Math.ceil(endHour).toString().padStart(2, '0')}:00-21:00`,
      count: analysis.evening,
      description: '晚間提交',
      isWarning: false,
    },
    {
      label: '21:00-23:00',
      count: analysis.lateNight,
      description: '加班晚期',
      isWarning: false,
    },
    {
      label: '23:00-02:00',
      count: analysis.midnight,
      description: '深夜加班',
      isWarning: analysis.midnight > 0,
    },
    {
      label: '02:00-06:00',
      count: analysis.dawn,
      description: '凌晨編程',
      isWarning: analysis.dawn > 0,
    },
  ]

  timeRanges.forEach(({ label, count, description, isWarning }) => {
    if (count === 0) return

    const percentage = maxCount > 0 ? (count / maxCount) * barLength : 0
    const filledLength = Math.min(barLength, Math.max(0, Math.round(percentage)))
    const bar = '█'.repeat(filledLength) + ' '.repeat(barLength - filledLength)
    const countText = count.toString().padStart(3)
    const warningLabel = isWarning ? chalk.red(' ⚠️') : ''

    // 計算該時段的頻率（這裡的count是天數，不是提交數）
    const weeklyAvg = (count / analysis.totalWeeks).toFixed(1)
    const monthlyAvg = (count / analysis.totalMonths).toFixed(1)
    const freqText = chalk.gray(` 平均每週${weeklyAvg}天 每月${monthlyAvg}天`)

    console.log(`${label}: ${bar} ${countText}天 (${description})${warningLabel}${freqText}`)
  })

  console.log()

  // 顯示深夜加班天數和占比
  if (analysis.midnightDays > 0) {
    const rateColor = analysis.midnightRate > 10 ? chalk.red : analysis.midnightRate > 5 ? chalk.yellow : chalk.green
    console.log(
      `深夜/凌晨加班天數: ${chalk.bold(analysis.midnightDays.toString())}天 / ${analysis.totalWorkDays}天工作日 (${rateColor(analysis.midnightRate.toFixed(1) + '%')})`
    )
    console.log()
  }
}
