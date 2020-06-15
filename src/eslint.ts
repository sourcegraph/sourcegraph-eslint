import * as sourcegraph from 'sourcegraph'
import { from, Observable } from 'rxjs'
import { switchMap } from 'rxjs/operators'
import { IGitCommit } from './graphql-schema'
import gql from 'tagged-template-noop'
import { resolveDocumentURI } from './uri'
import { startOfDay, sub } from 'date-fns'
import { queryGraphQL } from './api'
import { determineCommitsToQuery } from './search'

const ESLINT_BRAND_COLOR = 'rgb(75, 50, 195)'
const DEFAULT_STEP = {
    days: 7,
}

async function getView(step: Duration, repository: { repo: string; path: string }): Promise<sourcegraph.View> {
    const dates = getDaysToQuery(step)
    const commits = await determineCommitsToQuery(dates, repository.repo)
    const diagnosticsResult = await queryGraphQL(
        gql`
            query Diagnostics($repo: String!, $path: String!) {
                repository(name: $repo) {
                    ${commits.map(
                        ({ commit }, index) => gql`
                        commit${index}: commit(rev: "${commit}") {
                            tree(path: $path) {
                                lsif(toolName: "eslint-formatter-lsif") {
                                    diagnostics {
                                        totalCount
                                    }
                                }
                            }
                        }
                    `
                    )}
                }
            }
        `,
        {
            repo: repository.repo,
            path: repository.path,
        }
    )

    if (!diagnosticsResult.repository) {
        throw new Error('Unknown repository ' + repository.repo)
    }
    const data = Object.entries(diagnosticsResult.repository).map(([field, commitData]) => {
        const index = +field.slice('commit'.length)
        return {
            date: dates[index].getTime(),
            totalCount: (commitData as IGitCommit).tree?.lsif?.diagnostics.totalCount ?? 0,
        }
    })
    const view: sourcegraph.View = {
        title: 'ESLint warnings',
        content: [
            {
                chart: 'line',
                xAxis: {
                    type: 'number',
                    scale: 'time',
                    dataKey: 'date',
                },
                series: [
                    {
                        name: `${repository.repo}/${repository.path}`.replace(/\/+$/, ''),
                        dataKey: 'totalCount',
                        stroke: ESLINT_BRAND_COLOR,
                    },
                ],
                data,
            },
        ],
    }
    return view
}

export function activate(context: sourcegraph.ExtensionContext): void {
    context.subscriptions.add(
        sourcegraph.app.registerViewProvider('eslint.directory', {
            where: 'directory',
            provideView: ({ viewer }) =>
                from(sourcegraph.configuration).pipe(
                    switchMap(async () => {
                        const settings = sourcegraph.configuration.get().value
                        return getView(
                            settings['eslint.step'] || DEFAULT_STEP,
                            resolveDocumentURI(viewer.directory.uri)
                        )
                    })
                ),
        })
    )
    const globalProvideView = (): Observable<sourcegraph.View> =>
        from(sourcegraph.configuration).pipe(
            switchMap(async () => {
                const settings = sourcegraph.configuration.get().value
                return getView(settings['eslint.step'] || DEFAULT_STEP, {
                    repo: settings['eslint.insight.repository'],
                    path: '',
                })
            })
        )
    context.subscriptions.add(
        sourcegraph.app.registerViewProvider('eslint.insightsPage', {
            where: 'insightsPage',
            provideView: globalProvideView,
        })
    )
    context.subscriptions.add(
        sourcegraph.app.registerViewProvider('eslint.homepage', {
            where: 'homepage',
            provideView: globalProvideView,
        })
    )
}

function getDaysToQuery(step: globalThis.Duration): Date[] {
    const now = startOfDay(new Date())
    const dates: Date[] = []
    for (let index = 0, date = now; index < 7; index++) {
        dates.unshift(date)
        date = sub(date, step)
    }
    return dates
}
