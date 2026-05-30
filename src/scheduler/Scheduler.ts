export const REFRESH_SCHEDULE = {
  market_data: 'Every 10 minutes (trading hours)',
  news: 'Hourly',
  filings: 'Daily 06:00',
  hiring: 'Every Monday 09:00',
  regulatory: 'Every Monday 09:00',
  esg: 'First business day of each quarter',
} as const

export type RefreshType = keyof typeof REFRESH_SCHEDULE

export class Scheduler {
  private watchlist: string[] = []

  addToWatchlist(ticker: string): void {
    if (!this.watchlist.includes(ticker)) {
      this.watchlist.push(ticker)
    }
  }

  removeFromWatchlist(ticker: string): void {
    this.watchlist = this.watchlist.filter(t => t !== ticker)
  }

  getWatchlist(): string[] {
    return [...this.watchlist]
  }

  getRefreshSchedule(type: RefreshType): string {
    return REFRESH_SCHEDULE[type]
  }

  // Reserved interfaces — to be implemented after Bright Data integration
  // async triggerRefresh(ticker: string, type: RefreshType): Promise<void>
  // async startMonitoring(): Promise<void>
  // async stopMonitoring(): Promise<void>
}
