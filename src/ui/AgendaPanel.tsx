/**
 * Panneau d'envoi d'une note vers Google Agenda.
 *
 * Il ne s'ouvre que sur une note exportable : ni chiffrée, ni rangée dans le
 * coffre. L'écran de note masque déjà le bouton dans ces cas, mais ce composant
 * ne s'en remet pas à son appelant — voir `raisonIndisponible`.
 *
 * Aucun sélecteur natif : des champs de chiffres et des pastilles. Ajouter un
 * module natif de date obligerait à reconstruire l'APK pour une saisie que ces
 * champs couvrent, et ferait entrer dans le projet une dépendance native de
 * plus. La date et l'heure ont en revanche leur propre composant, parce qu'un
 * champ libre y demandait un « / » et un « : » que le clavier numérique ne
 * donne pas.
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

/** Étiquette lisible d'une durée en minutes. */
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
  /** Vraie si la note est chiffrée ou rangée dans le coffre. */
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
   * Pourquoi l'envoi est impossible, ou null s'il ne l'est pas.
   *
   * Une seule raison affichée, la plus en amont : proposer de se connecter à
   * Google alors que la note ne partira de toute façon pas ferait faire une
   * autorisation pour rien.
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
      {/* Raccourcis de jour. Ils écrivent dans le champ plutôt que de le
          remplacer par un état séparé : ce qui est affiché reste modifiable
          à la main, et il n'y a qu'une source de vérité. */}
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

      {/* Ce qui partira, écrit en toutes lettres. « 12/08 14:00 » se relit mal
          quand on vient de taper des chiffres ; « mardi 12 août » se vérifie
          d'un coup d'œil, et c'est là qu'on voit qu'on s'est trompé de jour. */}
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
 * Bouton d'ouverture du panneau, pour la barre basse de l'écran de note.
 *
 * Exporté d'ici plutôt que déclaré dans l'écran : la règle qui décide de sa
 * présence est la même que celle du panneau, et deux endroits la rendraient
 * divergente au premier changement.
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
  // Masqué, pas grisé. Un bouton grisé invite à chercher comment l'activer ;
  // ici il n'y a rien à activer, la note ne partira jamais par construction.
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
