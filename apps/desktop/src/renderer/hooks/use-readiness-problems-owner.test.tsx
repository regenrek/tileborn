// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { showReadinessProblems } from '@/lib/readiness-gate';
import { useEditorUiStore } from '@/stores/editor-ui-store';
import { useReadinessProblemsOwner } from './use-readiness-problems-owner';

describe('readiness Problems owner', () => {
  beforeEach(() => {
    useEditorUiStore.setState({ bottomDrawerOpen: false, bottomDrawerTab: 'jobs' });
  });

  it('opens the closed drawer and selects Problems', () => {
    renderHook(() => useReadinessProblemsOwner());
    act(() => showReadinessProblems());
    expect(useEditorUiStore.getState()).toMatchObject({
      bottomDrawerOpen: true,
      bottomDrawerTab: 'problems',
    });
  });
});
