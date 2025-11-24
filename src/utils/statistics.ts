/**
 * 統計工具函數
 * 提供常用的統計計算方法
 */

/**
 * 計算百分位數
 * @param sortedValues 已排序的數值陣列
 * @param percentile 百分位（0-100）
 * @returns 計算得到的百分位值
 *
 * @example
 * calculatePercentile([1, 2, 3, 4, 5], 50) // 傳回 3 (中位數)
 * calculatePercentile([1, 2, 3, 4, 5], 25) // 傳回 2 (第一四分位數)
 * calculatePercentile([1, 2, 3, 4, 5], 75) // 傳回 4 (第三四分位數)
 */
export function calculatePercentile(sortedValues: number[], percentile: number): number {
  if (sortedValues.length === 0) return 0
  const index = (percentile / 100) * (sortedValues.length - 1)
  const lower = Math.floor(index)
  const upper = Math.ceil(index)
  const weight = index - lower

  if (lower === upper) {
    return sortedValues[lower]
  }

  return sortedValues[lower] * (1 - weight) + sortedValues[upper] * weight
}

