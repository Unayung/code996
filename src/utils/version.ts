import * as fs from 'fs'
import * as path from 'path'

/**
 * 讀取 package.json 中的版本號
 */
export function getPackageVersion(): string {
  try {
    // 從目前文件向上兩级找到package.json
    const packageJsonPath = path.join(__dirname, '../../package.json')
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'))
    return packageJson.version
  } catch (error) {
    // 如果讀取失敗，嘗試從进程目錄讀取
    try {
      const packageJsonPath = path.join(process.cwd(), 'package.json')
      const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'))
      return packageJson.version
    } catch (error2) {
      // 如果讀取失敗，傳回預設版本號
      return '0.0.0'
    }
  }
}
