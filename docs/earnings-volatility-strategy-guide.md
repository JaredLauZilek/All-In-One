# Selling Earnings Volatility — Strategy Summary & Implementation Guide

> Source: YouTube transcript on a short earnings-volatility strategy (short straddles vs.
> long calendar spreads), backed by a claimed dataset of ~4,500 stocks, 2007–present,
> ~72,500 earnings events. Kept in-repo as the reference for the **evs** mini-app
> (`evs-scanner/` + `web/src/apps/evs/`).
>
> **Disclaimer:** This document summarizes claims made in a video. The backtest results,
> Kelly fractions, and return figures are the creator's, not independently verified.
> Options selling around earnings carries substantial tail risk. Not financial advice.

## The core idea

Sell options volatility immediately before quarterly earnings announcements and close
shortly after. Two effects pay: **IV crush** (pre-earnings implied vol collapses once
results are known) and **overpriced expected moves** (stocks move less than options
imply, on average). The edge exists because hedgers are price-insensitive and
speculators bid up short-dated options.

## Two structures

| | Short Straddle | Long Calendar Spread |
|---|---|---|
| Construction | Sell ATM call + put, front expiration | Sell front-month ATM, buy back-month ATM (~30d later), same strike |
| Max loss | Unlimited (worst observed −8,130%) | Debit paid (worst −105%) |
| Filtered mean/trade (claimed) | +9% (sd 48%) | +7.3% (sd 28%) |
| Author's pick | No | **Yes** — survivable losses |

## Timing

- **Entry:** ~15 min before the close on the trading day before the announcement.
- **Exit:** ~15 min after the open on the trading day after. Holding to the next close
  loses (post-earnings announcement drift).

## The three entry filters (the actual edge — unfiltered, both structures break even)

1. **Term-structure slope** `(IV45 − IVfront) / (45 − DTEfront)` must be ≤ **−0.00406**
   (steep backwardation). Front = first expiry after earnings. Most important filter.
2. **30-day average share volume** ≥ **1,500,000**.
3. **IV30 / RV30** ≥ **1.25**, with RV30 computed via the **Yang-Zhang** estimator
   (close-to-close std × √252 acceptable fallback).

**Verdict logic:** all 3 pass → RECOMMEND · slope + one other → CONSIDER · slope fails →
AVOID (always). Filtering removed ~90% of events. The author only trades RECOMMEND.

## Position sizing (the survival component)

- Full Kelly (60% of capital per calendar debit) goes bankrupt in ~5% of Monte Carlo
  paths — never use it. The "$10k → $1M in a year" headline was lucky full-Kelly paths.
- Author's sizing: **~10% Kelly ≈ 6% of portfolio per calendar debit**
  (`contracts = floor(0.06 × portfolio / (debit × 100))`).
- Claimed profile at 10% Kelly: 66% win rate, ~90% CAGR mean, ~20% mean max drawdown,
  Sharpe ~3.5, expectancy ~$265/trade on $10k.

## Trade construction

At the ATM strike: sell the expiration immediately after earnings, buy the expiration
~30 calendar days later; pick the more liquid side (calls or puts). Report the implied
move as `front ATM straddle / spot`. Skip if either leg's bid/ask spread exceeds ~10% of
mid, or if one contract's debit exceeds the sizing budget.

## Tracking

Log every trade (entry/exit, filter values, P&L) and compare the running win rate and
expectancy against the expected profile (66% / +7.3% / sd 28%) — that is how a normal
drawdown is distinguished from a dead edge.

## Implementation notes (as built in this repo)

The `evs-scan` edge function implements Steps A–F of the original guide's spec: Yahoo
Finance data (swappable layer), ATM-IV interpolation across the term structure, the
three thresholds as tunable constants (stored per-user in `evs_settings`), verdict
logic, calendar construction with liquidity warnings, and graceful failure on missing
chains/garbage IVs. The trade tracker is `evs_trades` + the `/evs/trades` page. Batch
scanning of the daily earnings calendar (Step F's `--batch`) and the Monte Carlo module
(Step G) are not built yet.
