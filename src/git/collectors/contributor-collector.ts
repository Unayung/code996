import { GitLogOptions } from '../../types/git-types'
import { BaseCollector } from './base-collector'

/**
 * 参與者與元資料統計採集器
 * 負責統計提交總數、参與人數、首末提交日期等
 */
export class ContributorCollector extends BaseCollector {
  /**
   * 統計符合過濾條件的 commit 數量
   * 注意：由于需要支援作者排除過濾和時區過濾，這裡使用 log 而不是 rev-list
   */
  async countCommits(options: GitLogOptions): Promise<number> {
    const { path } = options

    // 如果沒有作者排除過濾且沒有時區過濾，使用更高效的 rev-list
    if (!options.ignoreAuthor && !options.timezone) {
      const args = ['rev-list', '--count', 'HEAD']
      this.applyCommonFilters(args, options)

      const output = await this.execGitCommand(args, path)
      const count = parseInt(output.trim(), 10)

      return isNaN(count) ? 0 : count
    }

    // 有作者排除或時區過濾時，需要獲取詳細資訊進行過濾
    // 格式: "Author Name <email@example.com>|ISO_TIMESTAMP"
    const args = ['log', '--format=%an <%ae>|%ai']
    this.applyCommonFilters(args, options)

    const output = await this.execGitCommand(args, path)
    const lines = output.split('\n').filter((line) => line.trim())

    let count = 0
    for (const line of lines) {
      const parts = line.split('|')
      if (parts.length < 2) {
        continue
      }

      const author = parts[0]
      const isoTimestamp = parts[1]

      // 檢查作者過濾
      if (this.shouldIgnoreAuthor(author, options.ignoreAuthor)) {
        continue
      }

      // 檢查時區過濾
      if (options.timezone) {
        const timezoneMatch = isoTimestamp.match(/([+-]\d{4})$/)
        if (!timezoneMatch || timezoneMatch[1] !== options.timezone) {
          continue
        }
      }

      count++
    }

    return count
  }

  /**
   * 統計参與人數（不同的作者數量）
   */
  async getContributorCount(options: GitLogOptions): Promise<number> {
    const { path } = options

    // 格式: "Author Name <email@example.com>|ISO_TIMESTAMP"
    const args = ['log', '--format=%an <%ae>|%ai']
    this.applyCommonFilters(args, options)

    const output = await this.execGitCommand(args, path)
    const lines = output.split('\n').filter((line) => line.trim())

    const uniqueAuthors = new Set<string>()
    for (const line of lines) {
      const parts = line.split('|')
      if (parts.length < 2) {
        continue
      }

      const author = parts[0]
      const isoTimestamp = parts[1]

      // 檢查是否應該排除此作者
      if (this.shouldIgnoreAuthor(author, options.ignoreAuthor)) {
        continue
      }

      // 檢查時區過濾
      if (options.timezone) {
        const timezoneMatch = isoTimestamp.match(/([+-]\d{4})$/)
        if (!timezoneMatch || timezoneMatch[1] !== options.timezone) {
          continue
        }
      }

      // 提取郵箱作為唯一標識
      const emailMatch = author.match(/<(.+?)>/)
      if (emailMatch) {
        uniqueAuthors.add(emailMatch[1])
      }
    }

    return uniqueAuthors.size
  }

  /**
   * 獲取最早的commit時間
   */
  async getFirstCommitDate(options: GitLogOptions): Promise<string> {
    const { path } = options

    // 格式: "Author Name <email@example.com>|YYYY-MM-DD|ISO_TIMESTAMP"
    const args = ['log', '--format=%an <%ae>|%cd|%ai', '--date=format:%Y-%m-%d', '--reverse', '--max-parents=0']
    this.applyCommonFilters(args, options)

    const output = await this.execGitCommand(args, path)
    const lines = output.split('\n').filter((line) => line.trim())

    // 找到第一個未被排除的提交
    for (const line of lines) {
      const parts = line.split('|')
      if (parts.length < 3) {
        continue
      }

      const author = parts[0]
      const date = parts[1]
      const isoTimestamp = parts[2]

      // 檢查作者過濾
      if (this.shouldIgnoreAuthor(author, options.ignoreAuthor)) {
        continue
      }

      // 檢查時區過濾
      if (options.timezone) {
        const timezoneMatch = isoTimestamp.match(/([+-]\d{4})$/)
        if (!timezoneMatch || timezoneMatch[1] !== options.timezone) {
          continue
        }
      }

      return date.trim()
    }

    return ''
  }

  /**
   * 獲取最新的commit時間
   */
  async getLastCommitDate(options: GitLogOptions): Promise<string> {
    const { path } = options

    // 格式: "Author Name <email@example.com>|YYYY-MM-DD|ISO_TIMESTAMP"
    // 注意：不能使用 -1 限制，因為最新的提交可能被排除
    const args = ['log', '--format=%an <%ae>|%cd|%ai', '--date=format:%Y-%m-%d']
    this.applyCommonFilters(args, options)

    const output = await this.execGitCommand(args, path)
    const lines = output.split('\n').filter((line) => line.trim())

    // 找到第一個未被排除的提交（因為 log 預設按時間倒序）
    for (const line of lines) {
      const parts = line.split('|')
      if (parts.length < 3) {
        continue
      }

      const author = parts[0]
      const date = parts[1]
      const isoTimestamp = parts[2]

      // 檢查作者過濾
      if (this.shouldIgnoreAuthor(author, options.ignoreAuthor)) {
        continue
      }

      // 檢查時區過濾
      if (options.timezone) {
        const timezoneMatch = isoTimestamp.match(/([+-]\d{4})$/)
        if (!timezoneMatch || timezoneMatch[1] !== options.timezone) {
          continue
        }
      }

      return date.trim()
    }

    return ''
  }
}
