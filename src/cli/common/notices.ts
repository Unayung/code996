import chalk from 'chalk'

/** 輸出全局提示資訊 */
export function printGlobalNotices(): void {
  console.log()
  console.log(chalk.cyan.bold('ℹ️  使用提示:'))
  console.log()
  console.log('  ● 隱私保護：所有對 Git 資料的分析均在本機進行，不會上傳任何結果或日誌。')
  console.log(
    '  ● 分析局限性：工具僅統計 git log 中的 commit 時間。然而，實際工作還包括開會、學習、摸魚、維護文件、除錯自測等活動。因此，報告無法涵蓋全部的實際工作時間，分析結果準確性有限，請謹慎參考。'
  )
  console.log(`  ● 使用限制：${chalk.bold('本專案分析結果僅供個人參考，請勿用於"作惡"或不當用途')}。`)
  console.log('  ● 命令說明：使用 code996 help 查看更多命令。')
  console.log()
  console.log(`  其他說明請參考 Github：${chalk.cyan.bold('https://github.com/hellodigua/code996')}`)
  console.log(`  繁體中文 fork Github：${chalk.cyan.bold('https://github.com/unayung/code996')}`)
  console.log()
}
