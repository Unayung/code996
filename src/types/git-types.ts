/**
 * 時間統計粒度
 */
export type TimeGranularity = 'hour' | 'half-hour'

export interface GitLogOptions {
  path: string
  since?: string
  until?: string
  silent?: boolean // 靜默模式，不打印日誌
  authorPattern?: string // 作者過濾正則（包含特定作者）
  ignoreAuthor?: string // 排除作者正則（排除特定作者，如 bot|jenkins）
  ignoreMsg?: string // 排除提交消息正則（排除特定消息，如 merge|lint）
  timezone?: string // 時區過濾（例如: +0800, -0700），只採集指定時區的提交
}

export interface GitLogData {
  byHour: TimeCount[] // 時間分布資料（48個半小時点）
  byDay: TimeCount[]
  totalCommits: number
  dailyFirstCommits?: DailyFirstCommit[]
  dayHourCommits?: DayHourCommit[]
  dailyLatestCommits?: DailyLatestCommit[]
  dailyCommitHours?: DailyCommitHours[]
  dailyCommitCounts?: DailyCommitCount[] // 每日提交數（用於判斷工作日/週末）
  contributors?: number // 参與人數
  firstCommitDate?: string // 第一次提交日期
  lastCommitDate?: string // 最後一次提交日期
  granularity?: TimeGranularity // 時間粒度標識（預設 'half-hour'）
  timezoneData?: TimezoneData // 時區分布資料
}

export interface TimeCount {
  time: string
  count: number
}

export interface WorkTimeDetectionResult {
  startHour: number
  endHour: number
  isReliable: boolean
  sampleCount: number
  detectionMethod: 'quantile-window' | 'default' | 'manual'
  confidence: number // 置信度百分比 (0-100)
  startHourRange?: {
    startHour: number
    endHour: number
  }
  endHourRange?: {
    startHour: number
    endHour: number
  }
  endDetectionMethod?: 'standard-shift' | 'backward-threshold' | 'default' | 'manual'
}

export interface ParsedGitData {
  hourData: TimeCount[]
  dayData: TimeCount[]
  totalCommits: number
  workHourPl: WorkTimePl
  workWeekPl: WorkWeekPl
  detectedWorkTime?: WorkTimeDetectionResult
  dailyFirstCommits?: DailyFirstCommit[]
  weekdayOvertime?: WeekdayOvertimeDistribution
  weekendOvertime?: WeekendOvertimeDistribution
  lateNightAnalysis?: LateNightAnalysis
}

export type WorkTimePl = [{ time: '工作' | '加班'; count: number }, { time: '工作' | '加班'; count: number }]

export type WorkWeekPl = [{ time: '工作日' | '週末'; count: number }, { time: '工作日' | '週末'; count: number }]

export interface ValidationResult {
  isValid: boolean
  errors: string[]
  warnings: string[]
}

export interface WorkTimeData {
  workHourPl: Array<{ time: string; count: number }>
  workWeekPl: Array<{ time: string; count: number }>
  hourData: TimeCount[]
}

export interface Result996 {
  index996: number
  index996Str: string
  overTimeRadio: number
}

export interface DailyFirstCommit {
  date: string
  minutesFromMidnight: number
}

/**
 * 每日最晚提交時間
 */
export interface DailyLatestCommit {
  date: string
  minutesFromMidnight: number // 最晚提交距離午夜的分鐘數 (0-1439)
}

/**
 * 每日提交小時列表
 */
export interface DailyCommitHours {
  date: string
  hours: Set<number> // 該天所有提交的小時（去重）
}

/**
 * 每日提交數
 */
export interface DailyCommitCount {
  date: string // 日期 (YYYY-MM-DD)
  count: number // 提交數
}

/**
 * 按星期幾和小時的提交統計
 */
export interface DayHourCommit {
  weekday: number // 1-7 (週一到週日)
  hour: number // 0-23
  count: number
}

/**
 * 工作日加班分布（週一到週五的下班後提交數）
 */
export interface WeekdayOvertimeDistribution {
  monday: number
  tuesday: number
  wednesday: number
  thursday: number
  friday: number
  peakDay?: string // 加班最多的一天
  peakCount?: number // 加班最多的次數
}

/**
 * 週末加班分布
 */
export interface WeekendOvertimeDistribution {
  saturdayDays: number // 週六加班天數
  sundayDays: number // 週日加班天數
  casualFixDays: number // 暫時修复天數（提交1-2次）
  realOvertimeDays: number // 真正加班天數（提交>=3次）
}

/**
 * 深夜加班分析
 */
export interface LateNightAnalysis {
  evening: number // 下班後-21:00 晚間提交
  lateNight: number // 21:00-23:00 加班晚期
  midnight: number // 23:00-02:00 深夜加班
  dawn: number // 02:00-06:00 凌晨提交
  midnightDays: number // 有深夜/凌晨提交的天數
  totalWorkDays: number // 總工作日天數
  midnightRate: number // 深夜加班占比 (%)
  totalWeeks: number // 總週數
  totalMonths: number // 總月數
}

/**
 * 每日工作跨度資料
 */
export interface DailyWorkSpan {
  date: string // 日期 (YYYY-MM-DD)
  firstCommitMinutes: number // 首次提交距離午夜的分鐘數
  lastCommitMinutes: number // 最後提交距離午夜的分鐘數
  spanHours: number // 工作跨度（小時）
  commitCount: number // 當天提交數
}

/**
 * 月度趨勢資料
 */
export interface MonthlyTrendData {
  month: string // 月份 (YYYY-MM)
  index996: number // 996指數
  avgWorkSpan: number // 平均工作跨度（小時）
  workSpanStdDev: number // 工作跨度標準差（小時）
  avgStartTime: string // 平均開始工作時間 (HH:mm)
  avgEndTime: string // 平均結束工作時間 (HH:mm)
  latestEndTime: string // 最晚結束時間 (HH:mm)
  totalCommits: number // 總提交數
  contributors: number // 参與人數
  workDays: number // 工作天數
  dataQuality: 'sufficient' | 'limited' | 'insufficient' // 資料品質標記
  confidence: 'high' | 'medium' | 'low' // 置信度等级
}

/**
 * 趨勢分析結果
 */
export interface TrendAnalysisResult {
  monthlyData: MonthlyTrendData[]
  timeRange: {
    since: string
    until: string
  }
  summary: {
    totalMonths: number
    avgIndex996: number
    avgWorkSpan: number
    trend: 'increasing' | 'decreasing' | 'stable' // 整體趨勢
  }
}

// ====== 以下是多儲存庫功能的新增類型 ======

/**
 * 儲存庫資訊
 */
export interface RepoInfo {
  name: string
  path: string
}

/**
 * 儲存庫分析記錄（用於對比表）
 */
export interface RepoAnalysisRecord {
  repo: RepoInfo
  data: GitLogData
  result: Result996
  status: 'success' | 'failed'
  error?: string
  classification?: any // 專案分類結果（ProjectClassificationResult）
}

/**
 * Analyze 命令的選項（同時用於多儲存庫分析）
 */
export interface AnalyzeOptions {
  since?: string
  until?: string
  allTime?: boolean
  year?: string
  self?: boolean
  hours?: string
  halfHour?: boolean // 是否以半小時粒度展示
  trend?: boolean // 是否顯示月度趨勢分析
  author?: string // 指定作者正則（只包含特定作者）
  ignoreAuthor?: string // 排除作者正則
  ignoreMsg?: string // 排除提交消息正則
  timezone?: string // 指定時區進行分析 (例如: +0800, -0700)
  skipUserAnalysis?: boolean // 是否跳過團隊工作模式分析
  maxUsers?: number // 最大分析使用者數（預設30）
  cn?: boolean // 強制開啟中國節假日調休模式
}

/**
 * 時區資料
 */
export interface TimezoneData {
  totalCommits: number
  timezones: Array<{ offset: string; count: number }>
}

/**
 * 跨時區分析結果
 */
export interface TimezoneAnalysisResult {
  isCrossTimezone: boolean // 是否為跨時區專案
  crossTimezoneRatio: number // 非主導時區的占比 (0-1)
  dominantTimezone: string | null // 主導時區，如 "+0800"
  dominantRatio: number // 主導時區占比 (0-1)
  sleepPeriodRatio: number // 睡眠時段（連續5小時最少）的提交占比 (0-1)
  confidence: number // 檢測置信度 (0-100)
  warning?: string // 警告資訊
  timezoneGroups?: Array<{ offset: string; count: number; ratio: number }> // 時區分組詳情
}

// ====== 以下是團隊工作模式分析的新增類型 ======

/**
 * 工作強度等级
 */
export type WorkIntensityLevel = 'normal' | 'moderate' | 'heavy'

/**
 * 個人工作模式
 */
export interface UserWorkPattern {
  author: string // 作者名
  email: string // 郵箱
  totalCommits: number // 提交數
  commitPercentage: number // 占比（百分比）
  timeDistribution: TimeCount[] // 個人的時間分布（24小時）
  workingHours?: WorkTimeDetectionResult // 個人的上下班時間（算法識別）
  // 基於每日首末commit的中位數
  avgStartTimeMedian?: number // 平均上班時間（中位數，小時數）
  avgEndTimeMedian?: number // 平均下班時間（中位數，小時數）
  validDays?: number // 有效天數（用於判斷資料可靠性）
  index996?: number // 個人的996指數
  overtimeStats?: {
    workdayOvertime: number // 工作日加班提交數
    weekendOvertime: number // 週末加班提交數
    totalOvertime: number // 總加班提交數
  }
  intensityLevel?: WorkIntensityLevel // 工作強度等级
}

/**
 * 團隊分析結果
 */
export interface TeamAnalysis {
  coreContributors: UserWorkPattern[] // 核心貢獻者（過濾後）
  totalAnalyzed: number // 實際分析的使用者數
  totalContributors: number // 總貢獻者數
  filterThreshold: number // 過濾閾值（提交數）
  baselineEndHour: number // 團隊基準下班時間（P50中位數）

  // 工作強度分布
  distribution: {
    normal: UserWorkPattern[] // 正常作息（基準下班時間之前）
    moderate: UserWorkPattern[] // 適度加班（基準+0到+2小時）
    heavy: UserWorkPattern[] // 嚴重加班（基準+2小時之後）
  }

  // 統計指標
  statistics: {
    median996: number // 中位數996指數
    mean996: number // 平均996指數
    range: [number, number] // 996指數範圍 [最小, 最大]
    percentiles: {
      p25: number // 25%分位數
      p50: number // 50%分位數（中位數）
      p75: number // 75%分位數
      p90: number // 90%分位數
    }
  }

  // 健康度評估
  healthAssessment: {
    overallIndex: number // 專案整體996指數
    teamMedianIndex: number // 團隊中位數996指數
    conclusion: string // 結论文本
    warning?: string // 警告資訊
  }
}
