-- EDIT_COD_LOCKED is folded into EDIT_SETTLEMENTS: whoever held it keeps the access.
UPDATE admins
SET permissions = array_remove(
  CASE WHEN 'EDIT_SETTLEMENTS' = ANY(permissions) THEN permissions ELSE array_append(permissions, 'EDIT_SETTLEMENTS') END,
  'EDIT_COD_LOCKED')
WHERE 'EDIT_COD_LOCKED' = ANY(permissions);
