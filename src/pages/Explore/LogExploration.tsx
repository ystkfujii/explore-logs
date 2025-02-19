import { css } from '@emotion/css';
import React from 'react';

import { AdHocVariableFilter, GrafanaTheme2, SelectableValue } from '@grafana/data';
import {
  AdHocFiltersVariable,
  CustomVariable,
  DataSourceVariable,
  getUrlSyncManager,
  SceneComponentProps,
  SceneControlsSpacer,
  SceneFlexItem,
  sceneGraph,
  SceneObject,
  SceneObjectBase,
  SceneObjectState,
  SceneObjectUrlSyncConfig,
  SceneObjectUrlValues,
  SceneRefreshPicker,
  SceneTimePicker,
  SceneTimeRange,
  SceneVariableSet,
  SplitLayout,
  VariableValueSelectors,
} from '@grafana/scenes';
import { Text, useStyles2 } from '@grafana/ui';

import { LogsByServiceScene } from '../../components/Explore/LogsByService/LogsByServiceScene';
import { SelectStartingPointScene } from './SelectStartingPointScene';
import {
  DetailsSceneUpdated,
  explorationDS,
  StartingPointSelectedEvent,
  VAR_DATASOURCE,
  VAR_FIELDS,
  VAR_FILTERS,
  VAR_LINE_FILTER,
  VAR_PATTERNS,
} from '../../utils/shared';
import { DetailsScene } from '../../components/Explore/LogsByService/DetailsScene';
import { AppliedPattern } from '../../components/Explore/types';
import { VariableHide } from '@grafana/schema';
import { Pattern } from 'components/Explore/LogsByService/Pattern';
import pluginJson from '../../plugin.json';

type LogExplorationMode = 'start' | 'logs';

export interface LogExplorationState extends SceneObjectState {
  topScene?: SceneObject;
  controls: SceneObject[];
  // history: ExplorationHistory;
  body: SplitLayout;

  mode?: LogExplorationMode;
  detailsScene?: DetailsScene;
  showDetails?: boolean;

  // just for the starting data source
  initialDS?: string;
  initialFilters?: AdHocVariableFilter[];

  patterns?: AppliedPattern[];
}

const DS_LOCALSTORAGE_KEY = `${pluginJson.id}.datasource`;

export class LogExploration extends SceneObjectBase<LogExplorationState> {
  protected _urlSync = new SceneObjectUrlSyncConfig(this, { keys: ['mode', 'patterns'] });

  public constructor(state: Partial<LogExplorationState>) {
    super({
      $timeRange: state.$timeRange ?? new SceneTimeRange({}),
      $variables:
        state.$variables ??
        getVariableSet(state.initialDS ?? localStorage.getItem(DS_LOCALSTORAGE_KEY) ?? undefined, state.initialFilters),
      controls: state.controls ?? [
        new VariableValueSelectors({ layout: 'vertical' }),
        new SceneControlsSpacer(),
        new SceneTimePicker({}),
        new SceneRefreshPicker({}),
      ],
      body: buildSplitLayout(),
      detailsScene: new DetailsScene({}),
      ...state,
    });

    this.addActivationHandler(this._onActivate.bind(this));
  }

  static Component = ({ model }: SceneComponentProps<LogExploration>) => {
    const { body } = model.useState();
    const styles = useStyles2(getStyles);

    return <div className={styles.bodyContainer}> {body && <body.Component model={body} />} </div>;
  };

  public _onActivate() {
    if (!this.state.topScene) {
      this.setState({ topScene: getTopScene(this.state.mode) });
    }
    if (this.state.mode !== undefined && this.state.mode !== 'start') {
      this.setState({
        controls: [...this.state.controls],
      });
    }

    // Services
    const serviceVar = this.state.$variables?.getByName(VAR_FIELDS) as AdHocFiltersVariable;
    this.setupAutoHideVariable(serviceVar);
    this.updateVariableHide(serviceVar);

    // Labels
    const filtersVar = this.state.$variables?.getByName(VAR_FILTERS) as AdHocFiltersVariable;
    this.setupAutoHideVariable(filtersVar);
    this.updateVariableHide(filtersVar);

    // Some scene elements publish this
    this.subscribeToEvent(StartingPointSelectedEvent, this._handleStartingPointSelected.bind(this));
    this.subscribeToEvent(DetailsSceneUpdated, this._handleDetailsSceneUpdated.bind(this));

    this.subscribeToState((newState, oldState) => {
      if (newState.showDetails !== oldState.showDetails) {
        if (newState.showDetails) {
          this.state.body.setState({ secondary: new DetailsScene(this.state.detailsScene?.state || {}) });
          this.setState({ detailsScene: undefined });
        } else {
          this.state.body.setState({ secondary: undefined });
          this.setState({ detailsScene: new DetailsScene({}) });
        }
      }

      if (newState.mode !== oldState.mode) {
        this.setState({ topScene: getTopScene(newState.mode) });
      }

      const patternsVariable = sceneGraph.lookupVariable(VAR_PATTERNS, this);
      if (patternsVariable instanceof CustomVariable) {
        const patternsLine =
          newState.patterns?.map((p) => `${p.type === 'include' ? '|> ' : '!> '} \`${p.pattern}\``)?.join(' ') || '';
        patternsVariable.changeValueTo(patternsLine);
      }
    });

    return () => {
      getUrlSyncManager().cleanUp(this);
    };
  }

  getUrlState() {
    return {
      mode: this.state.mode,
      patterns: this.state.mode === 'start' ? '' : JSON.stringify(this.state.patterns),
    };
  }

  updateFromUrl(values: SceneObjectUrlValues) {
    const stateUpdate: Partial<LogExplorationState> = {};
    if (values.mode !== this.state.mode) {
      const mode: LogExplorationMode = (values.mode as LogExplorationMode) ?? 'start';
      stateUpdate.mode = mode;
      stateUpdate.topScene = getTopScene(mode);
    }
    if (this.state.mode === 'start') {
      // Clear patterns on start
      stateUpdate.patterns = undefined;
    } else if (values.patterns && typeof values.patterns === 'string') {
      stateUpdate.patterns = JSON.parse(values.patterns) as AppliedPattern[];
    }
    this.setState(stateUpdate);
  }

  private _handleStartingPointSelected(evt: StartingPointSelectedEvent) {
    this.setState({
      mode: 'logs',
    });
  }

  private _handleDetailsSceneUpdated(evt: DetailsSceneUpdated) {
    this.setState({ showDetails: true });
  }

  private setupAutoHideVariable(variable: AdHocFiltersVariable) {
    variable.subscribeToState(() => {
      this.updateVariableHide(variable);
    });
  }

  private updateVariableHide(variable: AdHocFiltersVariable) {
    if (variable.state.filters.length === 0) {
      if (variable.state.hide !== VariableHide.hideVariable) {
        variable.setState({
          hide: VariableHide.hideVariable,
        });
      }
    } else {
      if (variable.state.hide !== VariableHide.hideLabel) {
        variable.setState({
          hide: VariableHide.hideLabel,
        });
      }
    }
  }
}

export class LogExplorationScene extends SceneObjectBase {
  static Component = ({ model }: SceneComponentProps<LogExplorationScene>) => {
    const logExploration = sceneGraph.getAncestor(model, LogExploration);
    const { controls, topScene, mode, patterns } = logExploration.useState();
    const styles = useStyles2(getStyles);
    const includePatterns = patterns ? patterns.filter((pattern) => pattern.type === 'include') : [];
    const excludePatterns = patterns ? patterns.filter((pattern) => pattern.type !== 'include') : [];
    return (
      <div className={styles.container}>
        {controls && (
          <div className={styles.controlsContainer}>
            <div className={styles.filters}>
              {controls.map((control) =>
                control instanceof VariableValueSelectors ? (
                  <control.Component key={control.state.key} model={control} />
                ) : null
              )}
            </div>
            <div className={styles.controls}>
              {controls.map((control) =>
                control instanceof VariableValueSelectors === false ? (
                  <control.Component key={control.state.key} model={control} />
                ) : null
              )}
            </div>
          </div>
        )}
        {mode === 'logs' && patterns && patterns.length > 0 && (
          <div>
            {includePatterns.length > 0 && (
              <div className={styles.patternsContainer}>
                <Text variant="bodySmall" weight="bold">
                  {excludePatterns.length > 0 ? 'Include patterns' : 'Patterns'}
                </Text>
                <div className={styles.patterns}>
                  {includePatterns.map((p) => (
                    <Pattern
                      key={p.pattern}
                      pattern={p.pattern}
                      type={p.type}
                      onRemove={() => logExploration.setState({ patterns: patterns?.filter((pat) => pat !== p) || [] })}
                    />
                  ))}
                </div>
              </div>
            )}
            {excludePatterns.length > 0 && (
              <div className={styles.patternsContainer}>
                <Text variant="bodySmall" weight="bold">
                  Exclude patterns:
                </Text>
                <div className={styles.patterns}>
                  {excludePatterns.map((p) => (
                    <Pattern
                      key={p.pattern}
                      pattern={p.pattern}
                      type={p.type}
                      onRemove={() => logExploration.setState({ patterns: patterns?.filter((pat) => pat !== p) || [] })}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
        <div className={styles.body}>{topScene && <topScene.Component model={topScene} />}</div>
      </div>
    );
  };
}

function buildSplitLayout() {
  return new SplitLayout({
    direction: 'row',
    initialSize: 0.6,
    primary: new SceneFlexItem({
      body: new LogExplorationScene({}),
    }),
  });
}

function getTopScene(mode?: LogExplorationMode) {
  if (mode === 'logs') {
    return new LogsByServiceScene({});
  }
  return new SelectStartingPointScene({});
}

function getVariableSet(initialDS?: string, initialFilters?: AdHocVariableFilter[]) {
  const operators = ['=', '!='].map<SelectableValue<string>>((value) => ({
    label: value,
    value,
  }));

  const filterVariable = new AdHocFiltersVariable({
    name: VAR_FILTERS,
    datasource: explorationDS,
    layout: 'vertical',
    label: 'Service',
    filters: initialFilters ?? [],
    expressionBuilder: renderLogQLLabelFilters,
    hide: VariableHide.hideLabel,
    key: 'adhoc_service_filter',
  });

  filterVariable._getOperators = () => {
    return [
      {
        label: '=',
        value: '=',
      },
    ];
  };

  const fieldsVariable = new AdHocFiltersVariable({
    name: VAR_FIELDS,
    label: 'Filters',
    applyMode: 'manual',
    layout: 'vertical',
    getTagKeysProvider: () => Promise.resolve({ values: [] }),
    getTagValuesProvider: () => Promise.resolve({ values: [] }),
    expressionBuilder: renderLogQLFieldFilters,
    hide: VariableHide.hideLabel,
  });

  fieldsVariable._getOperators = () => {
    return operators;
  };

  const dsVariable = new DataSourceVariable({
    name: VAR_DATASOURCE,
    label: 'Data source',
    value: initialDS,
    pluginId: 'loki',
  });
  dsVariable.subscribeToState((newState) => {
    const dsValue = `${newState.value}`;
    newState.value && localStorage.setItem(DS_LOCALSTORAGE_KEY, dsValue);
  });
  return new SceneVariableSet({
    variables: [
      dsVariable,
      filterVariable,
      fieldsVariable,
      new CustomVariable({
        name: VAR_PATTERNS,
        value: '',
        hide: VariableHide.hideVariable,
      }),
      new CustomVariable({ name: VAR_LINE_FILTER, value: '', hide: VariableHide.hideVariable }),
    ],
  });
}

export function renderLogQLLabelFilters(filters: AdHocVariableFilter[]) {
  return '{' + filters.map((filter) => renderFilter(filter)).join(', ') + '}';
}

export function renderLogQLFieldFilters(filters: AdHocVariableFilter[]) {
  return filters.map((filter) => `| ${renderFilter(filter)}`).join(' ');
}

function renderFilter(filter: AdHocVariableFilter) {
  return `${filter.key}${filter.operator}\`${filter.value}\``;
}

function getStyles(theme: GrafanaTheme2) {
  return {
    bodyContainer: css({
      flexGrow: 1,
      display: 'flex',
      minHeight: '100%',
      flexDirection: 'column',
    }),
    container: css({
      flexGrow: 1,
      display: 'flex',
      gap: theme.spacing(2),
      minHeight: '100%',
      flexDirection: 'column',
      padding: theme.spacing(2),
      maxWidth: '100vw',
    }),
    body: css({
      flexGrow: 1,
      display: 'flex',
      flexDirection: 'column',
      gap: theme.spacing(1),
    }),
    controlsContainer: css({
      display: 'flex',
      gap: theme.spacing(2),
      justifyContent: 'space-between',
      alignItems: 'flex-start',
    }),
    filters: css({
      display: 'flex',
      gap: theme.spacing(2),
      width: 'calc(100% - 450)',
      flexWrap: 'wrap',
      alignItems: 'flex-end',
      '& + div[data-testid="data-testid Dashboard template variables submenu Label Filters"]:empty': {
        visibility: 'hidden',
      },

      //@todo not like this
      // The filter variables container: i.e. services, filters
      '&:first-child': {
        // The wrapper of each filter
        '& > div': {
          // the 'service_name' filter wrapper
          '&:nth-child(2) > div':{
            gap: 0,
          },
          // The actual inputs container
          '& > div': {
            flexWrap: 'wrap',
            // wrapper around all inputs
            '& > div': {
              maxWidth: '380px',

              // Wrapper around each input: i.e. label name, binary operator, value
              '& > div': {
                // These inputs need to flex, otherwise the value takes all of available space and they look broken
                flex: '1 0 auto',

                // The value input needs to shrink when the parent component is at max width
                '&:nth-child(3)': {
                  flex: '0 1 auto',
                },
              },
            },
          },
        },
      },

      ['div >[title="Add filter"]']: {
        border: 0,
        visibility: 'hidden',
        width: 0,
        padding: 0,
        margin: 0,
      },
    }),
    controls: css({
      display: 'flex',
      maxWidth: 450,
      paddingTop: theme.spacing(3),
      gap: theme.spacing(2),
    }),
    rotateIcon: css({
      svg: { transform: 'rotate(180deg)' },
    }),
    patternsContainer: css({
      paddingBottom: theme.spacing(1),
      overflow: 'hidden',
    }),
    patterns: css({
      display: 'flex',
      gap: theme.spacing(1),
      alignItems: 'center',
      flexWrap: 'wrap',
    }),
  };
}
