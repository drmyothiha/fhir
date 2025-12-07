// fhir-builder.js
class FHIRBuilder {
  static createAppointment({
    patientId,
    patientName,
    startTime,
    durationMinutes = 30,
    reason = '',
    priority = 0,
    status = 'booked'
  }) {
    const start = new Date(startTime).toISOString();
    const end = new Date(new Date(startTime).getTime() + durationMinutes * 60000).toISOString();
    
    return {
      resourceType: 'Appointment',
      id: `appt-${Date.now()}`,
      meta: {
        profile: ['http://hl7.org/fhir/StructureDefinition/Appointment']
      },
      status: status,
      serviceType: [{
        coding: [{
          system: 'http://terminology.hl7.org/CodeSystem/service-type',
          code: '57',
          display: 'Immunization'
        }]
      }],
      start: start,
      end: end,
      minutesDuration: durationMinutes,
      created: new Date().toISOString(),
      comment: reason,
      participant: [{
        actor: {
          reference: `Patient/${patientId}`,
          display: patientName
        },
        status: 'accepted',
        required: 'required'
      }],
      reasonCode: [{
        text: reason
      }],
      priority: priority
    };
  }

  static createPatient({
    id,
    name,
    gender,
    birthDate,
    phone,
    address
  }) {
    return {
      resourceType: 'Patient',
      id: id,
      identifier: [{
        system: 'http://hospital.example.org/patient',
        value: id.toString()
      }],
      name: [{
        use: 'official',
        text: name,
        given: [name.split(' ')[0]],
        family: name.split(' ').slice(1).join(' ')
      }],
      gender: gender,
      birthDate: birthDate,
      telecom: [{
        system: 'phone',
        value: phone,
        use: 'mobile'
      }],
      address: [{
        use: 'home',
        text: address,
        city: 'Yangon',
        state: 'Yangon Region',
        country: 'MM'
      }]
    };
  }
}

module.exports = FHIRBuilder;