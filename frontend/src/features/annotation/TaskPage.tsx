import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import { Alert, Box, Skeleton, Stack } from '@mui/material';
import { api, ApiError } from '../../shared/api';
import { recordSubmission } from '../../shared/useThroughput';
import type { TaskDetail } from '../../shared/types';
import { AuditTimeline } from '../audit/AuditTimeline';
import { ReviewPanel } from '../review/ReviewPanel';
import { AnnotationWorkspace } from './AnnotationWorkspace';

export function TaskPage() {
  const { taskId = '' } = useParams();
  const client = useQueryClient();
  const navigate = useNavigate();
  const { data: task, error, isLoading, dataUpdatedAt, refetch } = useQuery({
    queryKey: ['task', taskId],
    queryFn: () => api.getTask(taskId),
  });

  const refreshAfterChange = (updated: TaskDetail) => {
    client.setQueryData(['task', taskId], updated);
    void client.invalidateQueries({ queryKey: ['audit', taskId] });
    void client.invalidateQueries({ queryKey: ['tasks'] });
  };

  /** After a decision the user goes back to the list and picks the next task themselves (no auto-advance). */
  function backToQueue(updated: TaskDetail, notice: string, reviewQueue: boolean) {
    const qs = new URLSearchParams({ project: updated.projectId });
    if (reviewQueue) qs.set('status', 'SUBMITTED');
    navigate(`/?${qs.toString()}`, { state: { notice } });
  }

  function onSubmitted(updated: TaskDetail) {
    refreshAfterChange(updated);
    recordSubmission();
    backToQueue(updated, `Submitted “${updated.title}” for review. Pick your next task from the queue.`, false);
  }

  function onReviewed(updated: TaskDetail) {
    refreshAfterChange(updated);
    const outcome = updated.status === 'APPROVED' ? 'Approved' : 'Sent back for changes';
    backToQueue(updated, `${outcome}: “${updated.title}”. Pick the next submission to review.`, true);
  }

  if (isLoading) {
    return (
      <Stack spacing={2}>
        <Skeleton variant="rounded" height={56} width="50%" />
        <Skeleton variant="rounded" height={64} />
        <Skeleton variant="rounded" height={380} />
      </Stack>
    );
  }
  if (error || !task) {
    const notFound = error instanceof ApiError && error.status === 404;
    return <Alert severity="error" role="alert">{notFound ? 'Task not found, or you do not have access to it.' : 'Could not load the task.'}</Alert>;
  }

  return (
    <Box sx={{ display: 'grid', gap: 3, gridTemplateColumns: { xs: '1fr', lg: 'minmax(0, 1fr) 340px' }, alignItems: 'start' }}>
      <AnnotationWorkspace
        key={`${task.id}:${dataUpdatedAt}`}
        task={task}
        onReload={() => { void refetch(); }}
        onSubmitted={onSubmitted}
      />
      <Stack component="aside" spacing={2} sx={{ position: { lg: 'sticky' }, top: { lg: 88 } }}>
        {task.canReview && <ReviewPanel task={task} onDone={onReviewed} />}
        <AuditTimeline taskId={task.id} />
      </Stack>
    </Box>
  );
}
