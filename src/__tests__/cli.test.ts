import { describe, it, expect, beforeEach, jest } from '@jest/globals'
import { CLIManager } from '../src/cli'
import * as chalk from 'chalk'

// Mock chalk to avoid color output in tests
jest.mock('chalk', () => ({
  blue: jest.fn((text) => text),
  yellow: jest.fn((text) => text),
  green: jest.fn((text) => text),
  red: jest.fn((text) => text),
  gray: jest.fn((text) => text),
  bold: { blue: jest.fn((text) => text) },
}))

describe('CLIManager', () => {
  let consoleSpy: jest.SpyInstance
  let cli: CLIManager

  beforeEach(() => {
    consoleSpy = jest.spyOn(console, 'log').mockImplementation()
    cli = new CLIManager()
  })

  afterEach(() => {
    consoleSpy.mockRestore()
  })

  describe('analyze command', () => {
    it('should handle analyze command with default options', async () => {
      cli.parse(['node', 'code996', 'analyze'])

      expect(consoleSpy).toHaveBeenCalledWith('分析儲存庫: .')
      expect(consoleSpy).toHaveBeenCalledWith('分析完成！ (此功能將在後續阶段實現)')
    })

    it('should handle analyze command with custom path', async () => {
      cli.parse(['node', 'code996', 'analyze', '/test/path'])

      expect(consoleSpy).toHaveBeenCalledWith('分析儲存庫: /test/path')
    })

    it('should handle analyze command with debug mode', async () => {
      cli.parse(['node', 'code996', 'analyze', '--debug'])

      expect(consoleSpy).toHaveBeenCalledWith('除錯模式開啟')
      expect(consoleSpy).toHaveBeenCalledWith('参數:')
    })
  })

  describe('help command', () => {
    it('should display help information', () => {
      cli.parse(['node', 'code996', 'help'])

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('code996'))
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('使用方法:'))
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('命令:'))
    })
  })

  describe('error handling', () => {
    it('should handle unknown commands', () => {
      const exitSpy = jest.spyOn(process, 'exit').mockImplementation()

      cli.parse(['node', 'code996', 'unknown'])

      expect(consoleSpy).toHaveBeenCalledWith("錯誤: 未知命令 'unknown'")
      expect(exitSpy).toHaveBeenCalledWith(1)

      exitSpy.mockRestore()
    })
  })
})
