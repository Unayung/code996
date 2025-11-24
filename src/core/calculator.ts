import { TimeCount, WorkTimeData, Result996 } from '../types/git-types'

/**
 * 計算 996 指數（完全複用原算法）
 * 這是專案的核心算法，用於評估專案的加班強度
 *
 * @param workTimeData 工作時間資料
 * @returns 996 指數結果
 */
export function calculate996Index(data: WorkTimeData): Result996 {
  const { workHourPl, workWeekPl, hourData } = data

  // y: 正常工作時間的 commit 數量
  const y = workHourPl[0].count

  // x: 加班時間的 commit 數量
  const x = workHourPl[1].count

  // m: 工作日的 commit 數量
  const m = workWeekPl[0].count

  // n: 週末的 commit 數量
  const n = workWeekPl[1].count

  /**
   * 修正後的加班 commit 數量
   *
   * 公式：x + (y * n) / (m + n)
   *
   * 說明：
   * - x: 工作日加班時間的 commit
   * - (y * n) / (m + n): 週末工作的修正值
   */
  const overTimeAmendCount = Math.round(x + (y * n) / (m + n))

  // 總 commit 數
  const totalCount = y + x

  // 加班 commit 百分比
  let overTimeRadio = Math.ceil((overTimeAmendCount / totalCount) * 100)

  // 针對低加班且資料量不足的情況進行特殊處理
  if (overTimeRadio === 0 && hourData.length < 9) {
    overTimeRadio = getUn996Radio({ hourData, totalCount })
  }

  /**
   * 996 指數 = 加班比例 * 3
   *
   * 乘以 3 的原因：
   * - 標準 996 的加班率約為 37.5%
   * - 37.5% * 3 ≈ 112.5 ≈ 100（四捨五入）
   * - 使得 996 工作制對應的指數約為 100
   */
  const index996 = overTimeRadio * 3

  // 生成分析文字
  const index996Str = generateDescription(index996)

  return {
    index996,
    index996Str,
    overTimeRadio,
  }
}

/**
 * 生成 996 指數分析文字
 * 使用統一的分析體系
 */
function generateDescription(index996: number): string {
  if (index996 <= 0) return '非常健康，是理想的專案情況'
  if (index996 <= 21) return '很健康，加班非常少'
  if (index996 <= 48) return '還行，偶爾加班，能接受'
  if (index996 <= 63) return '較差，加班文化比較嚴重'
  if (index996 <= 100) return '很差，接近996的程度'
  if (index996 <= 130) return '非常差，加班文化嚴重'
  return '加班文化非常嚴重，福報已經修滿了'
}

/**
 * 計算不加班比例
 * 用於處理工作量较少的專案
 *
 * 計算思路：
 * 1. 週末一定不加班
 * 2. 工作日的工作時間 < 9 小時
 * 3. 根據現有資料推算標準工作量（9小時）
 * 4. 計算實際工作量與標準工作量的差異
 *
 * @returns 负值，表示工作不饱和程度
 */
function getUn996Radio({ hourData, totalCount }: { hourData: TimeCount[]; totalCount: number }): number {
  // 計算每小時平均 commit 數
  const averageCommit = totalCount / hourData.length

  // 模拟標準工作日（9小時）的 commit 總數
  const mockTotalCount = averageCommit * 9

  // 計算工作饱和度（傳回负值）
  const radio = Math.ceil((totalCount / mockTotalCount) * 100) - 100

  return radio
}
