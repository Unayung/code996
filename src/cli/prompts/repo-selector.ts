import chalk from 'chalk'
import path from 'path'
import { RepoInfo } from '../../types/git-types'

/**
 * 交互式儲存庫選擇器
 * @param repos 候選儲存庫列表
 * @returns 使用者選擇的儲存庫列表
 */
export async function promptRepoSelection(repos: RepoInfo[]): Promise<RepoInfo[]> {
  if (repos.length === 0) {
    return []
  }

  if (repos.length === 1) {
    console.log(chalk.blue('✅ 僅發現 1 個儲存庫，預設選中。'))
    return repos
  }

  // 動態導入 @inquirer/prompts
  const { checkbox } = await import('@inquirer/prompts')

  // 獲取目前工作目錄，用於計算相對路徑
  const cwd = process.cwd()

  const choices = repos.map((repo) => {
    // 計算相對路徑，如果無法計算則使用原路徑
    let displayPath: string
    try {
      const relativePath = path.relative(cwd, repo.path)
      // 如果相對路徑比絕對路徑短，則使用相對路徑，否則使用絕對路徑
      displayPath = relativePath.length < repo.path.length ? relativePath : repo.path
      // 如果相對路徑是空字符串，表示就是目前目錄
      if (displayPath === '') {
        displayPath = '.'
      }
    } catch {
      displayPath = repo.path
    }

    return {
      name: `${chalk.bold(repo.name)} ${chalk.gray(`(${displayPath})`)}`,
      value: repo,
    }
  })

  const selected = await checkbox({
    message: '請選擇需要分析的儲存庫（空格選擇，回車確認）',
    choices,
    pageSize: Math.min(10, choices.length),
    validate: (answer) => {
      if (answer.length === 0) {
        return '請至少選擇一個儲存庫'
      }
      return true
    },
  })

  return selected
}
