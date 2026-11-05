// Adventure (Game Mode) page: hero, illustrated region map, quests, achievements and level rewards.
import { BarChart3, Swords } from 'lucide-react'
import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button, ErrorState, PageHeader, Section, Skeleton } from '@/components/ui'
import { useL } from '@/i18n'
import { useApi } from '@/lib/api'
import { useApp } from '@/lib/store'
import { AchievementsGrid } from '../components/AchievementsGrid'
import { AdventureMap } from '../components/AdventureMap'
import { GameMotion } from '../components/GameMotion'
import { HeroHeader } from '../components/HeroHeader'
import { QuestsPanel } from '../components/QuestsPanel'
import { RewardsPanel } from '../components/RewardsPanel'
import { normalizeRegions } from '../lib/regions'

export default function GamePage() {
  const L = useL()
  const navigate = useNavigate()
  // The store's game summary refreshes after every reward push – reload the page data when XP changes.
  const xpTick = useApp((s) => s.game?.totalXp ?? 0)
  const game = useApi('progress:game', undefined, [xpTick])
  const quests = useApi('progress:quests', undefined, [xpTick])
  const achievements = useApi('progress:achievements', undefined, [xpTick])
  const regions = useMemo(() => normalizeRegions(game.data?.regions), [game.data])

  return (
    <GameMotion>
      <div data-testid="page-game">
        <PageHeader
          icon={<Swords />}
          title={L('Adventure', 'Phiêu lưu')}
          subtitle={L(
            'Every lesson moves you across the map – from your first words to B2 / IELTS 6.5.',
            'Mỗi bài học đưa bạn đi tiếp trên bản đồ – từ những từ đầu tiên tới B2 / IELTS 6.5.',
          )}
          actions={
            <Button
              variant="secondary"
              icon={<BarChart3 className="size-4" />}
              onClick={() => navigate('/stats')}
              data-testid="open-stats"
            >
              {L('Statistics', 'Thống kê')}
            </Button>
          }
        />

        {game.error && !game.data ? (
          <div className="mb-8">
            <ErrorState error={game.error} onRetry={() => void game.reload()} />
          </div>
        ) : !game.data ? (
          <div className="mb-8 space-y-4" aria-busy="true">
            <Skeleton className="h-44 rounded-3xl" />
            <Skeleton className="h-[420px] rounded-3xl" />
          </div>
        ) : (
          <>
            <HeroHeader game={game.data} />
            <Section title={L('Adventure map', 'Bản đồ phiêu lưu')}>
              <AdventureMap regions={regions} />
            </Section>
          </>
        )}

        <Section title={L('Quests', 'Nhiệm vụ')}>
          <QuestsPanel
            data={quests.data}
            error={quests.error}
            loading={quests.loading}
            onRetry={() => void quests.reload()}
          />
        </Section>

        <Section title={L('Achievements', 'Thành tích')}>
          <AchievementsGrid
            data={achievements.data}
            error={achievements.error}
            loading={achievements.loading}
            onRetry={() => void achievements.reload()}
          />
        </Section>

        {game.data && (
          <Section title={L('Rewards · accent themes', 'Phần thưởng · màu giao diện')}>
            <RewardsPanel game={game.data} />
          </Section>
        )}
      </div>
    </GameMotion>
  )
}
