/**
 * Panel for sending a note to Google Calendar.
 *
 * It only opens on an exportable note: neither encrypted nor filed in the
 * vault. The note screen already hides the button in those cases, but this
 * component does not rely on its caller — see `raisonIndisponible`.
 *
 * No native picker: digit fields and chips. Adding a native date module would
 * mean rebuilding the APK for an input these fields already cover, and would
 * bring one more native dependency into the project. The date and the time do
 * get their own component, though, because a free field there asked for a "/"
 * and a ":" the numeric keypad does not provide.
 */

import { useMemo, useState } from 'react'
import { View } from 'react-native'
import { Button, Txt } from './components'
import { space } from './theme'
import { useToast } from './Toast'
import { IconButton } from './IconButton'
import { DateField } from './DateField'
import { TimeField } from './TimeField'
import {
  agendaConfigure,
  agendaUtilisable,
  useCompteGoogle,
  useConnecterAgenda,
  useEnvoyerVersAgenda,
} from '../google/agenda'
import {
  decalerJours,
  decrireCreneau,
  DUREES,
  lireCreneau,
  prochainCreneau,
} from '../google/creneau'

/** Readable label for a duration in minutes. */
function libelleDuree(minutes: number): string {
  if (minutes < 60) return `${minutes} min`
  const heures = minutes / 60
  return heures === 1 ? '1 h' : `${heures} h`
}

export function AgendaPanel({
  noteId,
  noteProtegee,
  onFerme,
}: {
  noteId: string
  /** True if the note is encrypted or filed in the vault. */
  noteProtegee: boolean
  onFerme: () => void
}) {
  const toast = useToast()

  const depart = useMemo(() => prochainCreneau(), [])
  const [date, setDate] = useState(depart.date)
  const [heure, setHeure] = useState(depart.heure)
  const [duree, setDuree] = useState<number>(DUREES[0])
  const [erreur, setErreur] = useState<string | null>(null)

  const compte = useCompteGoogle()
  const connecter = useConnecterAgenda()
  const envoyer = useEnvoyerVersAgenda()

  const lecture = lireCreneau(date, heure, duree)

  /**
   * Why sending is impossible, or null if it is not.
   *
   * A single reason shown, the furthest upstream: offering to connect to Google
   * when the note will not be sent anyway would make people grant an
   * authorisation for nothing.
   */
  const raisonIndisponible = noteProtegee
    ? 'Une note chiffrée ou rangée dans le coffre ne part pas vers Google. C’est ce que le chiffrement promet.'
    : !agendaConfigure
      ? 'L’export vers l’agenda n’est pas configuré sur cette installation. Voir la section « Agenda Google » du README.'
      : null

  if (raisonIndisponible) {
    return (
      <View style={{ gap: space.sm }}>
        <Txt variant="caption" tone="muted">
          {raisonIndisponible}
        </Txt>
      </View>
    )
  }

  const connecte = agendaUtilisable(compte.data)

  if (!connecte) {
    return (
      <View style={{ gap: space.sm }}>
        <Txt variant="caption" tone="muted">
          {compte.data?.needs_reauth
            ? 'L’autorisation Google a expiré. En mode test, Google la coupe tous les sept jours.'
            : 'Cairn a besoin de ton autorisation pour écrire dans ton agenda. Elle est distincte de ta connexion, et se retire quand tu veux.'}
        </Txt>
        <Button
          label={compte.data?.needs_reauth ? 'Réautoriser l’agenda' : 'Autoriser l’agenda'}
          busy={connecter.isPending}
          onPress={() => {
            connecter.mutate(undefined, {
              onSuccess: (r) => {
                if (!r.annule) toast('Agenda connecté.', { tone: 'success' })
              },
              onError: (e) => toast((e as Error).message, { tone: 'danger' }),
            })
          }}
        />
      </View>
    )
  }

  return (
    <View style={{ gap: space.sm }}>
      {/* Day shortcuts. They write into the field rather than replacing it with
          separate state: what is displayed stays editable by hand, and there is
          a single source of truth. */}
      <View style={{ flexDirection: 'row', gap: space.xs, flexWrap: 'wrap' }}>
        {[
          { label: 'Aujourd’hui', jours: 0 },
          { label: 'Demain', jours: 1 },
          { label: 'Dans une semaine', jours: 7 },
        ].map((choix) => (
          <Button
            key={choix.label}
            label={choix.label}
            variant="ghost"
            onPress={() => {
              setDate(decalerJours(prochainCreneau().date, choix.jours))
              setErreur(null)
            }}
            style={{ paddingHorizontal: space.sm }}
          />
        ))}
      </View>

      <View style={{ flexDirection: 'row', gap: space.sm }}>
        <View style={{ flex: 1.4 }}>
          <DateField
            label="Date"
            value={date}
            onChangeText={(v) => {
              setDate(v)
              setErreur(null)
            }}
          />
        </View>
        <View style={{ flex: 1 }}>
          <TimeField
            label="Heure"
            value={heure}
            onChangeText={(v) => {
              setHeure(v)
              setErreur(null)
            }}
          />
        </View>
      </View>

      <View style={{ gap: space.xs }}>
        <Txt variant="label" tone="secondary">
          Durée
        </Txt>
        <View style={{ flexDirection: 'row', gap: space.xs }}>
          {DUREES.map((d) => (
            <Button
              key={d}
              label={libelleDuree(d)}
              variant={d === duree ? 'primary' : 'ghost'}
              onPress={() => setDuree(d)}
              style={{ paddingHorizontal: space.md }}
            />
          ))}
        </View>
      </View>

      {/* What will be sent, spelled out. « 12/08 14:00 » is hard to reread
          right after typing digits; « mardi 12 août » is checked at a glance,
          and that is where you notice you picked the wrong day. */}
      <Txt variant="caption" tone={lecture.ok ? 'muted' : 'danger'}>
        {lecture.ok ? decrireCreneau(lecture.creneau) : lecture.erreur}
      </Txt>

      {erreur ? (
        <Txt variant="caption" tone="danger">
          {erreur}
        </Txt>
      ) : null}

      <Button
        label="Ajouter à l’agenda"
        busy={envoyer.isPending}
        disabled={!lecture.ok}
        onPress={() => {
          if (!lecture.ok) return
          setErreur(null)
          envoyer.mutate(
            { noteId, debut: lecture.creneau.debut, fin: lecture.creneau.fin },
            {
              onSuccess: () => {
                toast('Évènement ajouté à ton agenda.', { tone: 'success' })
                onFerme()
              },
              onError: (e) => setErreur((e as Error).message),
            },
          )
        }}
      />
    </View>
  )
}

/**
 * Button opening the panel, for the note screen's bottom bar.
 *
 * Exported from here rather than declared in the screen: the rule deciding
 * whether it shows is the same as the panel's, and two places would make it
 * diverge at the first change.
 */
export function AgendaBouton({
  actif,
  noteProtegee,
  onPress,
}: {
  actif: boolean
  noteProtegee: boolean
  onPress: () => void
}) {
  // Hidden, not greyed out. A greyed-out button invites people to look for how
  // to enable it; here there is nothing to enable, the note will never be sent
  // by construction.
  if (noteProtegee) return null

  return (
    <IconButton
      icon="calendar"
      label="Agenda"
      tooltip="Ajouter à Google Agenda"
      placement="top"
      active={actif}
      onPress={onPress}
    />
  )
}
