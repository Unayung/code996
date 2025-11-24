import chalk from 'chalk'
import { GitCollector } from '../../git/git-collector'
import { GitLogOptions } from '../../types/git-types'

/** 校驗樣本體量是否足夠，避免在 commit 太少時繼續分析 */
export async function ensureCommitSamples(
  collector: GitCollector,
  gitOptions: GitLogOptions,
  minCount: number,
  sceneLabel: string
): Promise<boolean> {
  const commitCount = await collector.countCommits(gitOptions)

  if (commitCount >= minCount) {
    return true
  }

  console.log(chalk.yellow(' ⚠️ 樣本不足 '))
  console.log(
    chalk.yellow(`目前${sceneLabel}範圍内僅檢測到 ${commitCount} 個 commit，低於可靠分析所需的 ${minCount} 個。`)
  )
  console.log(chalk.yellow('建議：擴大時間範圍、取消作者過濾，或積累更多提交後再試。'))

  return false
}
