import chalk from 'chalk'
import Table from 'cli-table3'
import { RepoAnalysisRecord } from '../../../types/git-types'

/**
 * 多儲存庫對比報表打印器
 */
export class MultiComparisonPrinter {
  /**
   * 打印各儲存庫的 996 指數對比表
   * @param records 各儲存庫的分析記錄
   */
  static print(records: RepoAnalysisRecord[]): void {
    if (records.length === 0) {
      return
    }

    // 過濾掉提交數為 0 的專案
    const filteredRecords = records.filter((record) => {
      // 保留失敗的記錄（顯示錯誤状態）
      if (record.status === 'failed') {
        return true
      }
      // 只過濾掉成功但沒有提交的專案
      return record.data.totalCommits > 0
    })

    // 如果過濾後沒有記錄，不顯示表格
    if (filteredRecords.length === 0) {
      console.log(chalk.yellow('⚠️ 所有儲存庫的提交數均為 0，無法生成對比表'))
      console.log()
      return
    }

    console.log(chalk.cyan.bold('📊 各儲存庫996指數對比:'))
    console.log()

    const table = new Table({
      head: [
        chalk.bold('序號'),
        chalk.bold('專案名称'),
        chalk.bold('996指數'),
        chalk.bold('加班比例'),
        chalk.bold('提交數'),
        chalk.bold('参與人數'),
        chalk.bold('起止時間'),
        chalk.bold('状態'),
      ],
      colWidths: [8, 25, 12, 12, 10, 10, 24, 10],
      wordWrap: true,
      style: {
        head: [],
        border: [],
      },
    })

    // 按 996 指數降序排序
    const sortedRecords = [...filteredRecords].sort((a, b) => {
      if (a.status === 'failed' && b.status === 'success') return 1
      if (a.status === 'success' && b.status === 'failed') return -1
      if (a.status === 'failed' && b.status === 'failed') return 0
      return b.result.index996 - a.result.index996
    })

    sortedRecords.forEach((record, index) => {
      if (record.status === 'success') {
        const indexValue = record.result.index996.toFixed(1)
        const indexColor = this.getIndexColor(record.result.index996)
        const timeRange = this.formatTimeRange(record.data.firstCommitDate, record.data.lastCommitDate)
        const contributors = record.data.contributors !== undefined ? record.data.contributors.toString() : '-'

        table.push([
          (index + 1).toString(),
          this.truncateName(record.repo.name, 30),
          indexColor(indexValue),
          `${record.result.overTimeRadio.toFixed(1)}%`,
          record.data.totalCommits.toString(),
          contributors,
          timeRange,
          chalk.green('✓'),
        ])
      } else {
        table.push([
          (index + 1).toString(),
          this.truncateName(record.repo.name, 30),
          chalk.gray('-'),
          chalk.gray('-'),
          chalk.gray('-'),
          chalk.gray('-'),
          chalk.gray('-'),
          chalk.red('✗'),
        ])
      }
    })

    console.log(table.toString())
    console.log()

    // 統計資訊
    const successCount = filteredRecords.filter((r) => r.status === 'success').length
    const failedCount = filteredRecords.length - successCount
    const filteredOutCount = records.length - filteredRecords.length

    console.log(chalk.blue('統計資訊:'))
    console.log(`  成功分析: ${chalk.green(successCount)} 個儲存庫`)
    if (failedCount > 0) {
      console.log(`  分析失敗: ${chalk.red(failedCount)} 個儲存庫`)
    }
    if (filteredOutCount > 0) {
      console.log(`  已過濾（提交數為0）: ${chalk.gray(filteredOutCount)} 個儲存庫`)
    }

    // 找出加班最嚴重和最轻松的儲存庫
    const successfulRecords = filteredRecords.filter((r) => r.status === 'success')
    if (successfulRecords.length > 1) {
      const maxRecord = successfulRecords.reduce((max, r) => (r.result.index996 > max.result.index996 ? r : max))
      const minRecord = successfulRecords.reduce((min, r) => (r.result.index996 < min.result.index996 ? r : min))

      console.log()
      console.log(`  加班最嚴重: ${chalk.red(maxRecord.repo.name)} (996指數: ${maxRecord.result.index996.toFixed(1)})`)
      console.log(
        `  工作最轻松: ${chalk.green(minRecord.repo.name)} (996指數: ${minRecord.result.index996.toFixed(1)})`
      )
    }

    console.log()
  }

  /**
   * 根據 996 指數選擇顏色
   */
  private static getIndexColor(index: number): (text: string) => string {
    if (index < 50) {
      return chalk.green
    } else if (index < 75) {
      return chalk.yellow
    } else if (index < 100) {
      return chalk.hex('#FF8C00') // 橙色
    } else {
      return chalk.red
    }
  }

  /**
   * 截斷專案名称
   */
  private static truncateName(name: string, maxLength: number): string {
    if (name.length <= maxLength) {
      return name
    }
    return name.substring(0, maxLength - 3) + '...'
  }

  /**
   * 格式化時間範圍
   */
  private static formatTimeRange(firstDate?: string, lastDate?: string): string {
    if (!firstDate && !lastDate) {
      return '-'
    }
    if (!firstDate) {
      return `至 ${lastDate}`
    }
    if (!lastDate) {
      return `${firstDate} 至今`
    }

    // 如果是同一天，只顯示一個日期
    if (firstDate === lastDate) {
      return firstDate
    }

    return `${firstDate}~${lastDate}`
  }
}
