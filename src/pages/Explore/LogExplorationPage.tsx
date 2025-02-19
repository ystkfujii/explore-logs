import React, { useEffect, useState } from 'react';
import { newLogsExploration } from '../../utils/utils';
import { LogExploration } from './LogExploration';
import { getUrlSyncManager } from '@grafana/scenes';

export const LogExplorationPage = () => {
  const [exploration] = useState(newLogsExploration());

  return <LogExplorationView exploration={exploration} />;
};

export function LogExplorationView({ exploration }: { exploration: LogExploration }) {
  const [isInitialized, setIsInitialized] = React.useState(false);

  useEffect(() => {
    if (!isInitialized) {
      getUrlSyncManager().initSync(exploration);
      setIsInitialized(true);
    }
  }, [exploration, isInitialized]);

  if (!isInitialized) {
    return null;
  }

  return <exploration.Component model={exploration} />;
}
