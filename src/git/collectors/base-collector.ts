import { spawn } from 'child_process'
import { GitLogOptions } from '../../types/git-types'

/**
 * 基礎Git命令執行器
 * 提供Git命令執行、儲存庫驗證和通用過濾功能
 */
export class BaseCollector {
  /**
   * 執行git命令並傳回輸出
   */
  protected async execGitCommand(args: string[], cwd: string): Promise<string> {
    return new Promise((resolve, reject) => {
      // 確保路徑是絕對路徑
      const absolutePath = require('path').resolve(cwd)

      const child = spawn('git', args, {
        cwd: absolutePath,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: {
          ...process.env,
          GIT_TERMINAL_PROMPT: '0',
          GIT_DIR: `${absolutePath}/.git`,
          GIT_WORK_TREE: absolutePath,
        },
      })

      let stdout = ''
      let stderr = ''

      child.stdout.on('data', (data) => {
        stdout += data.toString()
      })

      child.stderr.on('data', (data) => {
        stderr += data.toString()
      })

      child.on('close', (code) => {
        if (code === 0) {
          resolve(stdout)
        } else {
          reject(new Error(`Git命令執行失敗 (退出碼: ${code}): ${stderr}`))
        }
      })

      child.on('error', (err) => {
        reject(new Error(`無法執行git命令: ${err.message}`))
      })
    })
  }

  /**
   * 檢查是否為有效的Git儲存庫
   */
  async isValidGitRepo(path: string): Promise<boolean> {
    try {
      await this.execGitCommand(['status'], path)
      return true
    } catch {
      return false
    }
  }

  /**
   * 為 git 命令附加通用過濾條件（時間範圍、作者包含、消息排除）
   */
  protected applyCommonFilters(args: string[], options: GitLogOptions): void {
    // 預設忽略合併提交
    args.push('--no-merges')

    if (options.since) {
      args.push(`--since=${options.since}`)
    }
    if (options.until) {
      args.push(`--until=${options.until}`)
    }
    if (options.authorPattern) {
      args.push('--regexp-ignore-case')
      args.push('--extended-regexp')
      args.push(`--author=${options.authorPattern}`)
    }
    // 排除特定提交消息（使用 Git 原生的 --grep + --invert-grep）
    if (options.ignoreMsg) {
      args.push('--regexp-ignore-case')
      args.push('--extended-regexp')
      args.push(`--grep=${options.ignoreMsg}`)
      args.push('--invert-grep')
    }
  }

  /**
   * 解析 format-local 輸出的時間戳，提取日期和小時資訊
   */
  protected parseLocalTimestamp(timestamp: string): { dateKey: string; hour: number; minute: number } | null {
    const match = timestamp.match(/^(\d{4})-(\d{2})-(\d{2})[T\s](\d{2}):(\d{2})/)
    if (!match) {
      return null
    }

    const [, year, month, day, hourStr, minuteStr] = match
    const hour = parseInt(hourStr, 10)
    const minute = parseInt(minuteStr, 10)

    if (Number.isNaN(hour) || Number.isNaN(minute)) {
      return null
    }

    return {
      dateKey: `${year}-${month}-${day}`,
      hour,
      minute,
    }
  }

  /**
   * 讀取 git config 配置項（不存在時傳回 null）
   */
  private async getGitConfigValue(key: string, path: string): Promise<string | null> {
    try {
      const value = await this.execGitCommand(['config', '--get', key], path)
      const trimmed = value.trim()
      return trimmed.length > 0 ? trimmed : null
    } catch {
      return null
    }
  }

  /**
   * 轉義正則特殊字符，建構安全的 --author 匹配模式
   */
  private escapeAuthorPattern(source: string): string {
    return source.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  }

  /**
   * 根據 CLI 選項解析作者身份，生成正則用於 git --author 過濾
   */
  async resolveSelfAuthor(path: string): Promise<{ pattern: string; displayLabel: string }> {
    const email = await this.getGitConfigValue('user.email', path)
    const name = await this.getGitConfigValue('user.name', path)

    if (!email && !name) {
      throw new Error('啟用 --self 需要先配置 git config user.name 或 user.email')
    }

    const hasEmail = Boolean(email)
    const hasName = Boolean(name)

    const displayLabel = hasEmail && hasName ? `${name} <${email}>` : email || name || '未知使用者'

    const pattern = hasEmail ? this.escapeAuthorPattern(email!) : this.escapeAuthorPattern(name!)

    return {
      pattern,
      displayLabel,
    }
  }

  /**
   * 檢查作者是否應該被排除（用於後處理過濾）
   * @param authorLine git log 輸出的作者行，格式: "Author Name <email@example.com>"
   * @param ignorePattern 排除作者的正則表達式
   * @returns true 表示應該排除，false 表示保留
   */
  protected shouldIgnoreAuthor(authorLine: string, ignorePattern?: string): boolean {
    if (!ignorePattern) {
      return false
    }

    try {
      const regex = new RegExp(ignorePattern, 'i') // 不區分大小寫
      return regex.test(authorLine)
    } catch (error) {
      // 如果正則表達式無效，打印警告並不排除
      console.warn(`警告: 無效的作者排除正則表達式 "${ignorePattern}": ${(error as Error).message}`)
      return false
    }
  }
}
